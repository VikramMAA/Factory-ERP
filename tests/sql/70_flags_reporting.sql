-- Phase 4: fn_daily_checks, v_weekly_variance, and SPEC.md Section 14.4's
-- test that matters most — two operators on the same product/machine, one
-- systematically 2 percentage points below the other, no single job
-- dramatic enough to trip a per-job rule. Assert the per-job rules stay
-- quiet and the 30-day operator scorecard finds the pattern anyway. That is
-- the actual product requirement; everything else is plumbing.

\set ON_ERROR_STOP on

do $$
declare
  v_op_a uuid := gen_random_uuid();
  v_op_b uuid := gen_random_uuid();
  v_machine uuid; v_product uuid; v_lot uuid;
begin
  insert into auth.users (id, email) values
    (v_op_a, 'scorecard_a@rewind.local'), (v_op_b, 'scorecard_b@rewind.local');
  insert into profiles (id, username, full_name) values
    (v_op_a, 'scorecard_a', 'Scorecard Operator A'), (v_op_b, 'scorecard_b', 'Scorecard Operator B');
  insert into user_roles (profile_id, role) values (v_op_a, 'operator'), (v_op_b, 'operator');

  select id into v_machine from machines where code = 'M3';
  select id into v_product from products where code = 'HW-100'; -- tolerance 4%, wide enough for this test's jitter
  insert into machine_operators (machine_id, profile_id) values (v_machine, v_op_a), (v_machine, v_op_b);

  insert into raw_lots (lot_code, gross_g, remaining_g) values ('LOT-SCORECARD', 100_000_000, 100_000_000)
  returning id into v_lot;

  create temporary table _sc_ids (name text primary key, id uuid);
  insert into _sc_ids values ('op_a', v_op_a), ('op_b', v_op_b), ('machine', v_machine),
    ('product', v_product), ('lot', v_lot);
end $$;

select id as op_a_id from _sc_ids where name = 'op_a' \gset
select id as op_b_id from _sc_ids where name = 'op_b' \gset
select id as machine_id from _sc_ids where name = 'machine' \gset
select id as product_id from _sc_ids where name = 'product' \gset
select id as lot_id from _sc_ids where name = 'lot' \gset

create or replace function _sc_make_job(p_operator uuid, p_yield_pct numeric)
returns void language plpgsql as $$
declare
  v_job uuid; v_w uuid; v_input_g integer := 10000; v_waste_g integer := 100; -- fixed, so only yield varies
  v_net_g integer; v_units integer;
  v_machine uuid := current_setting('test.machine_id')::uuid;
  v_product uuid := current_setting('test.product_id')::uuid;
  v_lot uuid := current_setting('test.lot_id')::uuid;
begin
  v_net_g := round(v_input_g * p_yield_pct / 100);
  v_units := round(v_net_g / 100.0); -- HW-100 target_net_g = 100

  insert into production_jobs (machine_id, operator_id, product_id, status)
  values (v_machine, p_operator, v_product, 'open') returning id into v_job;

  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'job_input', v_input_g, '2026/01/i.jpg', encode(gen_random_bytes(32), 'hex'), now(), p_operator)
  returning id into v_w;
  insert into job_inputs (job_id, raw_lot_id, weight_g, weighment_id) values (v_job, v_lot, v_input_g, v_w);

  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'job_output', v_net_g, '2026/01/o.jpg', encode(gen_random_bytes(32), 'hex'), now(), p_operator)
  returning id into v_w;
  insert into job_outputs (job_id, unit_count, gross_g, tube_tare_g, weighment_id)
  values (v_job, v_units, v_net_g, 0, v_w);

  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'job_waste', v_waste_g, '2026/01/w.jpg', encode(gen_random_bytes(32), 'hex'), now(), p_operator)
  returning id into v_w;
  insert into job_waste (job_id, weight_g, weighment_id) values (v_job, v_waste_g, v_w);

  perform close_job(v_job);
end $$;

select set_config('test.op_a_id', :'op_a_id', false);
select set_config('test.op_b_id', :'op_b_id', false);
select set_config('test.machine_id', :'machine_id', false);
select set_config('test.product_id', :'product_id', false);
select set_config('test.lot_id', :'lot_id', false);

do $$
declare
  i integer;
  a_yields numeric[] := array[95.6, 96.4]; -- operator A: mean 96.0%, small jitter
  b_yields numeric[] := array[93.6, 94.4]; -- operator B: mean 94.0%, same jitter, 2pp lower
begin
  for i in 1..20 loop
    perform _sc_make_job(current_setting('test.op_a_id')::uuid, a_yields[1 + (i % 2)]);
    perform _sc_make_job(current_setting('test.op_b_id')::uuid, b_yields[1 + (i % 2)]);
  end loop;
end $$;

do $$
declare v_count integer;
begin
  select count(*) into v_count from flags where code = 'YIELD_BELOW_BASELINE'
    and entity_id in (select id from production_jobs where operator_id in
      (current_setting('test.op_a_id')::uuid, current_setting('test.op_b_id')::uuid));
  assert v_count = 0,
    format('per-job rules should stay quiet on a steady 2pp systematic gap, but raised %s', v_count);
  raise notice 'OK: per-job rules stayed quiet on a steady systematic gap';
end $$;

do $$
begin
  refresh materialized view mv_operator_yield_30d;
  perform fn_operator_scorecard_flags();
end $$;

do $$
declare v_flags_b integer; v_flags_a integer;
begin
  select count(*) into v_flags_b from flags
  where code = 'OPERATOR_YIELD_GAP' and entity_id = current_setting('test.op_b_id')::uuid;
  assert v_flags_b = 1, format('expected exactly 1 OPERATOR_YIELD_GAP flag for operator B, got %s', v_flags_b);

  select count(*) into v_flags_a from flags
  where code = 'OPERATOR_YIELD_GAP' and entity_id = current_setting('test.op_a_id')::uuid;
  assert v_flags_a = 0, format('operator A is above the peer median and should not be flagged, got %s', v_flags_a);

  raise notice 'OK: the 30-day operator scorecard found the pattern per-job rules missed';
end $$;

drop function _sc_make_job(uuid, numeric);

-- fn_daily_checks: calibration missed, a job left open, cash not deposited.
do $$
declare v_op uuid := gen_random_uuid(); v_machine uuid; v_product uuid;
  v_job uuid; v_customer uuid;
begin
  insert into auth.users (id, email) values (v_op, 'daily_checks_driver@rewind.local');
  insert into profiles (id, username, full_name) values (v_op, 'daily_checks_driver', 'Daily Checks Driver');
  insert into user_roles (profile_id, role) values (v_op, 'driver');

  select id into v_machine from machines where code = 'M1';
  select id into v_product from products where code = 'SB-20';

  insert into production_jobs (machine_id, operator_id, product_id, status, started_at)
  values (v_machine, current_setting('test.op_a_id')::uuid, v_product, 'open', now() - interval '30 hours')
  returning id into v_job;

  insert into customers (code, shop_name) values ('CUST-DC-1', 'DC Shop') returning id into v_customer;
  insert into payments (customer_id, amount_paise, mode, collected_by, collected_at)
  values (v_customer, 50000, 'cash', v_op, now() - interval '60 hours');

  perform fn_daily_checks();

  perform 1 from flags where code = 'CALIBRATION_MISSED';
  assert found, 'expected a CALIBRATION_MISSED flag (no calibration_checks rows exist in this scratch db)';

  perform 1 from flags where code = 'JOB_LEFT_OPEN' and entity_id = v_job;
  assert found, 'expected a JOB_LEFT_OPEN flag for the 30-hour-old open job';

  perform 1 from flags where code = 'CASH_NOT_DEPOSITED' and entity_id = v_op;
  assert found, 'expected a CASH_NOT_DEPOSITED flag for the 60-hour-old undeposited cash';

  raise notice 'OK: fn_daily_checks raised all three expected flags';
end $$;

-- v_weekly_variance returns rows for closed jobs.
do $$
declare v_count integer;
begin
  select count(*) into v_count from v_weekly_variance;
  assert v_count > 0, 'expected v_weekly_variance to return rows given closed jobs exist';
  raise notice 'OK: v_weekly_variance returns rows';
end $$;

\echo 'Phase 4 flags and reporting checks passed'
