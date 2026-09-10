-- close_job and the flagging engine (SPEC.md Appendix C.3 #1-2, #6-10, #12).
-- Assertion 6 (30 stable jobs raise zero flags) matters more than assertion 7
-- (one outlier raises exactly one): a system that cries wolf on a stable line
-- gets switched off within a month.

\set ON_ERROR_STOP on

do $$
declare
  v_op uuid := gen_random_uuid();
  v_machine uuid; v_product uuid; v_lot uuid;
begin
  insert into auth.users (id, email) values (v_op, 'closejob_op@rewind.local');
  insert into profiles (id, username, full_name) values (v_op, 'closejob_op', 'Close Job Operator');
  insert into user_roles (profile_id, role) values (v_op, 'operator');

  select id into v_machine from machines where code = 'M1';
  select id into v_product from products where code = 'SB-20'; -- target_net_g 20, tolerance 3%
  insert into machine_operators (machine_id, profile_id) values (v_machine, v_op);

  insert into raw_lots (lot_code, gross_g, remaining_g) values ('LOT-CJ-1', 10_000_000, 10_000_000)
  returning id into v_lot;

  create temporary table _cj_ids (name text primary key, id uuid);
  insert into _cj_ids values ('op', v_op), ('machine', v_machine), ('product', v_product), ('lot', v_lot);
end $$;

select id as op_id from _cj_ids where name = 'op' \gset
select id as machine_id from _cj_ids where name = 'machine' \gset
select id as product_id from _cj_ids where name = 'product' \gset
select id as lot_id from _cj_ids where name = 'lot' \gset

-- Helper: open a job and post one input weighment, N output weighments and
-- one waste weighment, all as postgres (RLS is exercised separately in
-- 20_rls.sql; this file is about close_job's arithmetic and flag logic).
create or replace function _cj_make_job(p_input_g integer, p_units integer, p_unit_g integer, p_waste_g integer)
returns uuid language plpgsql as $$
declare
  v_job uuid; v_w uuid;
  v_op uuid := current_setting('test.op_id')::uuid;
  v_machine uuid := current_setting('test.machine_id')::uuid;
  v_product uuid := current_setting('test.product_id')::uuid;
  v_lot uuid := current_setting('test.lot_id')::uuid;
begin
  insert into production_jobs (machine_id, operator_id, product_id, status)
  values (v_machine, v_op, v_product, 'open') returning id into v_job;

  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'job_input', p_input_g, '2026/01/i.jpg', encode(gen_random_bytes(32), 'hex'), now(), v_op)
  returning id into v_w;
  insert into job_inputs (job_id, raw_lot_id, weight_g, weighment_id) values (v_job, v_lot, p_input_g, v_w);

  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'job_output', p_units * p_unit_g, '2026/01/o.jpg', encode(gen_random_bytes(32), 'hex'), now(), v_op)
  returning id into v_w;
  insert into job_outputs (job_id, unit_count, gross_g, tube_tare_g, weighment_id)
  values (v_job, p_units, p_units * p_unit_g, 0, v_w);

  if p_waste_g > 0 then
    insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
    values (gen_random_uuid(), 'job_waste', p_waste_g, '2026/01/w.jpg', encode(gen_random_bytes(32), 'hex'), now(), v_op)
    returning id into v_w;
    insert into job_waste (job_id, weight_g, weighment_id) values (v_job, p_waste_g, v_w);
  end if;

  return v_job;
end $$;

select set_config('test.op_id', :'op_id', false);
select set_config('test.machine_id', :'machine_id', false);
select set_config('test.product_id', :'product_id', false);
select set_config('test.lot_id', :'lot_id', false);

-- 1: hand-computed job. 10,000 g in, 480 units at 20 g (9,600 g net), 300 g
-- waste -> yield 96.000%, waste 3.000%, unaccounted 1.000%.
do $$
declare v_job uuid; j production_jobs; v_stock_before integer; v_stock_after integer; v_remaining_before integer; v_remaining_after integer;
begin
  select coalesce(sum(qty_delta), 0) into v_stock_before from inventory_moves
    where product_id = current_setting('test.product_id')::uuid;
  select remaining_g into v_remaining_before from raw_lots where id = current_setting('test.lot_id')::uuid;

  v_job := _cj_make_job(10000, 480, 20, 300);
  select * into j from close_job(v_job);

  assert j.yield_pct = 96.000, format('yield expected 96.000, got %s', j.yield_pct);
  assert j.waste_pct = 3.000, format('waste expected 3.000, got %s', j.waste_pct);
  assert j.unaccounted_pct = 1.000, format('unaccounted expected 1.000, got %s', j.unaccounted_pct);
  assert j.status = 'closed', 'job should be closed';

  select coalesce(sum(qty_delta), 0) into v_stock_after from inventory_moves
    where product_id = current_setting('test.product_id')::uuid;
  assert v_stock_after - v_stock_before = 480, format('stock should move by 480, moved by %s', v_stock_after - v_stock_before);

  select remaining_g into v_remaining_after from raw_lots where id = current_setting('test.lot_id')::uuid;
  assert v_remaining_before - v_remaining_after = 10000,
    format('raw lot should draw down by 10000, drew down by %s', v_remaining_before - v_remaining_after);

  raise notice 'OK: close_job arithmetic, stock and raw lot drawdown correct';
end $$;

-- 12: close_job on a job with no output errors and leaves the job open.
do $$
declare v_job uuid; v_op uuid := current_setting('test.op_id')::uuid;
  v_machine uuid := current_setting('test.machine_id')::uuid;
  v_product uuid := current_setting('test.product_id')::uuid;
begin
  insert into production_jobs (machine_id, operator_id, product_id, status)
  values (v_machine, v_op, v_product, 'open') returning id into v_job;

  begin
    perform close_job(v_job);
    raise exception 'expected check_violation, close_job succeeded with no output';
  exception
    when others then
      if sqlstate <> '23514' and sqlerrm not like '%no output weighment%' then
        raise;
      end if;
      raise notice 'OK: close_job on a job with no output errors';
  end;

  assert (select status from production_jobs where id = v_job) = 'open',
    'job should remain open after a failed close_job';
end $$;

-- 13: fn_yield_baseline returns n = 0 cleanly with no history for a fresh
-- product/machine pair (use HW-100, untouched by this file so far).
do $$
declare b record; v_product uuid;
begin
  select id into v_product from products where code = 'HW-100';
  select * into b from fn_yield_baseline(v_product, current_setting('test.machine_id')::uuid, null);
  assert b.n = 0, format('expected n=0, got %s', b.n);
  assert b.med is null, 'expected med null with no history';
  raise notice 'OK: fn_yield_baseline clean at n=0';
end $$;

-- 6 and 7: 30 jobs at a steady 96%% yield raise zero flags; one genuine
-- outlier raises exactly one YIELD_BELOW_BASELINE. Run on a fresh machine so
-- the baseline in this test isn't polluted by job #1 above.
do $$
declare v_job uuid; i integer; v_flags integer;
  v_machine uuid; v_product uuid := current_setting('test.product_id')::uuid;
begin
  select id into v_machine from machines where code = 'M2';
  perform set_config('test.machine_id', v_machine::text, false);

  for i in 1..30 loop
    v_job := _cj_make_job(10000, 480, 20, 300); -- steady 96% yield, no drift
    perform close_job(v_job);
  end loop;

  select count(*) into v_flags from flags where code = 'YIELD_BELOW_BASELINE';
  assert v_flags = 0, format('30 stable jobs should raise 0 yield flags, raised %s', v_flags);
  raise notice 'OK: 30 stable jobs raised zero YIELD_BELOW_BASELINE flags';

  -- One genuine outlier: 10,000 g in, 430 units at 20 g (8,600 g net, waste
  -- held at 300 g) -> yield 86%, a full 10 points under the 96% baseline.
  v_job := _cj_make_job(10000, 430, 20, 300);
  perform close_job(v_job);

  select count(*) into v_flags from flags where code = 'YIELD_BELOW_BASELINE';
  assert v_flags = 1, format('one outlier should raise exactly 1 yield flag, raised %s', v_flags);
  raise notice 'OK: one outlier raised exactly one YIELD_BELOW_BASELINE flag';

  -- 10: re-running fn_check_job_flags on the same job adds no duplicate flag
  -- (the partial unique index on open flags dedupes it).
  perform fn_check_job_flags(v_job);
  select count(*) into v_flags from flags where code = 'YIELD_BELOW_BASELINE';
  assert v_flags = 1, format('re-running fn_check_job_flags should not duplicate, count is %s', v_flags);
  raise notice 'OK: re-running fn_check_job_flags is idempotent';
end $$;

-- 8: a repeated photo_sha256 raises one critical DUPLICATE_PHOTO flag.
do $$
declare v_sha char(64) := encode(gen_random_bytes(32), 'hex');
  v_op uuid := current_setting('test.op_id')::uuid;
  v_count integer;
begin
  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'calibration', 5000, '2026/01/dup1.jpg', v_sha, now(), v_op);
  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'calibration', 5000, '2026/01/dup2.jpg', v_sha, now(), v_op);

  select count(*) into v_count from flags where code = 'DUPLICATE_PHOTO' and severity = 'critical';
  assert v_count = 1, format('expected exactly 1 duplicate-photo flag, got %s', v_count);
  raise notice 'OK: repeated photo_sha256 raised one critical DUPLICATE_PHOTO flag';
end $$;

-- 9: a backdated device_ts raises CLOCK_SKEW.
do $$
declare v_count integer; v_op uuid := current_setting('test.op_id')::uuid;
begin
  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'calibration', 5000, '2026/01/skew.jpg', encode(gen_random_bytes(32), 'hex'),
          now() - interval '2 hours', v_op);
  select count(*) into v_count from flags where code = 'CLOCK_SKEW';
  assert v_count >= 1, 'expected at least one CLOCK_SKEW flag';
  raise notice 'OK: backdated device_ts raised CLOCK_SKEW';
end $$;

drop function _cj_make_job(integer, integer, integer, integer);

\echo 'close_job and flagging engine checks passed'
