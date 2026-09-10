-- Phase 0 functional checks, run as postgres (table owner / definer-equivalent).
-- Runs after supabase/migrations/0001-0012 and 0017, plus seed.sql.

\set ON_ERROR_STOP on

do $$
declare
  v_op uuid := gen_random_uuid();
  v_machine uuid;
  v_scale uuid;
  v_weighment uuid;
begin
  insert into auth.users (id, email) values (v_op, 'operator1@rewind.local');
  insert into profiles (id, username, full_name) values (v_op, 'test_operator', 'Test Operator');
  insert into user_roles (profile_id, role) values (v_op, 'operator');

  select id into v_machine from machines where code = 'M1';
  select id into v_scale from scales where code = 'SC-1';
  insert into machine_operators (machine_id, profile_id) values (v_machine, v_op);

  -- 1. A weighment can be inserted (as table owner, no RLS in play here).
  insert into weighments (client_uuid, kind, gross_g, scale_id, photo_path,
                          photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'calibration', 5010, v_scale, '2026/01/x.jpg',
          repeat('a', 64), now(), v_op)
  returning id into v_weighment;

  assert (select count(*) from weighments where id = v_weighment) = 1,
    'weighment row should exist';
end $$;

-- 2. update weighments raises restrict_violation, even for the table owner.
do $$
begin
  begin
    update weighments set gross_g = 1 where true;
    raise exception 'expected restrict_violation, update succeeded';
  exception
    when restrict_violation then
      raise notice 'OK: update weighments blocked by trigger';
  end;
end $$;

-- 3. delete from weighments raises restrict_violation.
do $$
begin
  begin
    delete from weighments where true;
    raise exception 'expected restrict_violation, delete succeeded';
  exception
    when restrict_violation then
      raise notice 'OK: delete weighments blocked by trigger';
  end;
end $$;

-- 4. update inventory_moves raises restrict_violation.
do $$
declare v_product uuid; v_op uuid;
begin
  select id into v_product from products where code = 'SB-20';
  select id into v_op from profiles limit 1;
  insert into inventory_moves (product_id, qty_delta, weight_delta_g, reason, actor_id)
  values (v_product, 100, 2000, 'opening', v_op);

  begin
    update inventory_moves set qty_delta = 1 where true;
    raise exception 'expected restrict_violation, update succeeded';
  exception
    when restrict_violation then
      raise notice 'OK: update inventory_moves blocked by trigger';
  end;
end $$;

-- 5. Stock is derived: sum(qty_delta) over inventory_moves, never a stored column.
do $$
declare v_qty integer;
begin
  select coalesce(sum(qty_delta), 0) into v_qty from inventory_moves
  where product_id = (select id from products where code = 'SB-20');
  assert v_qty = 100, format('expected 100, got %s', v_qty);
end $$;

-- 6. A closed production job cannot flip back to closed via a second update
-- (freeze trigger). We fake a closed job directly since close_job() lands in Phase 1.
do $$
declare v_job uuid; v_machine uuid; v_op uuid; v_product uuid;
begin
  select id into v_machine from machines where code = 'M2';
  select id into v_op from profiles limit 1;
  select id into v_product from products where code = 'SB-20';

  insert into production_jobs (machine_id, operator_id, product_id, status,
                               input_g, output_units, output_net_g, waste_g)
  values (v_machine, v_op, v_product, 'closed', 10000, 480, 9600, 300)
  returning id into v_job;

  begin
    update production_jobs set closed_by = v_op where id = v_job;
    raise exception 'expected restrict_violation, update succeeded';
  exception
    when restrict_violation then
      raise notice 'OK: closed job frozen';
  end;
end $$;

-- 7. Yield / waste / unaccounted arithmetic on the closed job above.
do $$
declare j production_jobs;
begin
  select * into j from production_jobs where input_g = 10000 and output_units = 480;
  assert j.yield_pct = 96.000, format('expected yield 96.000, got %s', j.yield_pct);
  assert j.waste_pct = 3.000, format('expected waste 3.000, got %s', j.waste_pct);
  assert j.unaccounted_pct = 1.000, format('expected unaccounted 1.000, got %s', j.unaccounted_pct);
end $$;

-- 8. Every table in the public schema has RLS enabled.
do $$
declare v_count integer;
begin
  select count(*) into v_count from pg_tables t
  join pg_class c on c.relname = t.tablename
  where t.schemaname = 'public' and not c.relrowsecurity;
  assert v_count = 0, format('%s public tables have RLS disabled', v_count);
end $$;

\echo 'Phase 0 functional checks passed'
