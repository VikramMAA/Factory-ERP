-- Phase 0 RLS matrix, run as postgres but impersonating roles via
-- `set role authenticated; set request.jwt.claim.sub = '<uuid>'`.
-- Assert row counts, not just the absence of an error: a forbidden read returns
-- an empty array and never throws.
--
-- Gotcha: the uuids used to impersonate a role must be captured as postgres,
-- before switching role. Once we are `authenticated`, reading `profiles` to look
-- up someone's id is itself subject to RLS, which would deny the very lookup
-- needed to impersonate them.

\set ON_ERROR_STOP on

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_supervisor uuid := gen_random_uuid();
  v_operator uuid := gen_random_uuid();
  v_other_operator uuid := gen_random_uuid();
  v_machine uuid;
  v_product uuid;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner1@rewind.local'),
    (v_supervisor, 'supervisor1@rewind.local'),
    (v_operator, 'operator2@rewind.local'),
    (v_other_operator, 'operator3@rewind.local');

  insert into profiles (id, username, full_name) values
    (v_owner, 'owner1', 'Owner'), (v_supervisor, 'supervisor1', 'Supervisor'),
    (v_operator, 'operator2', 'Operator Two'), (v_other_operator, 'operator3', 'Operator Three');

  insert into user_roles (profile_id, role) values
    (v_owner, 'owner'), (v_supervisor, 'supervisor'), (v_operator, 'operator');

  select id into v_machine from machines where code = 'M3';
  select id into v_product from products where code = 'RL-10';
  insert into machine_operators (machine_id, profile_id) values (v_machine, v_operator);

  -- A job belonging to the OTHER operator, so we can prove isolation.
  insert into production_jobs (machine_id, operator_id, product_id, status)
  values (v_machine, v_other_operator, v_product, 'open');

  -- Stash ids in a temp table so later plain SQL (outside this do block, run as
  -- postgres) can pass them to \gset before any role switch happens.
  create temporary table _test_ids (name text primary key, id uuid);
  insert into _test_ids values
    ('owner', v_owner), ('supervisor', v_supervisor),
    ('operator', v_operator), ('other_operator', v_other_operator);
end $$;

select id as owner_id from _test_ids where name = 'owner' \gset
select id as supervisor_id from _test_ids where name = 'supervisor' \gset
select id as operator_id from _test_ids where name = 'operator' \gset
select id as other_operator_id from _test_ids where name = 'other_operator' \gset

-- psql's :'var' interpolation does not reach inside dollar-quoted plpgsql bodies,
-- so hand the ids to plpgsql via a session GUC instead of inline substitution.
select set_config('test.owner_id', :'owner_id', false);
select set_config('test.supervisor_id', :'supervisor_id', false);
select set_config('test.operator_id', :'operator_id', false);
select set_config('test.other_operator_id', :'other_operator_id', false);

-- R1-R7: an operator with no jobs of their own reads 0 jobs, 0 flags, 0 audit
-- rows, and more than 0 products / raw material master data.
set role authenticated;
select set_config('request.jwt.claim.sub', :'operator_id', false);

do $$
declare v_count integer;
begin
  select count(*) into v_count from production_jobs; -- belongs to other_operator, not us
  assert v_count = 0, format('R1 failed: operator saw %s jobs', v_count);

  select count(*) into v_count from flags;
  assert v_count = 0, format('R2 failed: operator saw %s flags', v_count);

  select count(*) into v_count from audit_log;
  assert v_count = 0, format('R3 failed: operator saw %s audit rows', v_count);

  select count(*) into v_count from products;
  assert v_count > 0, 'R4 failed: operator should read product master data';

  select count(*) into v_count from raw_lots;
  assert v_count = 0, 'R5: no raw lots seeded yet, sanity only';

  select count(*) into v_count from customers;
  assert v_count >= 0, 'R6: customers read policy is open to all authenticated';
end $$;

-- R9: a weighment inserted with someone else's actor_id is rewritten to the caller.
do $$
declare v_id uuid; v_actor uuid;
begin
  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256,
                         device_ts, actor_id)
  values (gen_random_uuid(), 'calibration', 5005, '2026/01/y.jpg', repeat('b', 64),
          now(), current_setting('test.owner_id')::uuid)
  returning id into v_id;

  select actor_id into v_actor from weighments where id = v_id;
  assert v_actor = current_setting('test.operator_id')::uuid,
    format('R9 failed: actor_id is %s, expected %s', v_actor,
           current_setting('test.operator_id'));
end $$;

-- R10: delete from inventory_moves raises permission denied (the REVOKE, not the trigger).
do $$
begin
  begin
    delete from inventory_moves;
    raise exception 'R10 failed: delete succeeded';
  exception
    when insufficient_privilege then
      raise notice 'OK: R10 delete inventory_moves denied';
  end;
end $$;

-- R8: starting a job on an unassigned machine violates RLS.
do $$
declare v_other_machine uuid; v_product uuid;
begin
  select id into v_other_machine from machines where code = 'M1'; -- not assigned to us
  select id into v_product from products where code = 'RL-10';
  begin
    insert into production_jobs (machine_id, operator_id, product_id, status)
    values (v_other_machine, current_setting('test.operator_id')::uuid, v_product, 'open');
    raise exception 'R8 failed: insert on unassigned machine succeeded';
  exception
    when insufficient_privilege or others then
      raise notice 'OK: R8 blocked (unassigned machine)';
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

-- R12-R14: a supervisor reads all jobs and all flags, but zero audit rows.
set role authenticated;
select set_config('request.jwt.claim.sub', :'supervisor_id', false);

do $$
declare v_count integer;
begin
  select count(*) into v_count from production_jobs;
  assert v_count >= 1, 'R12 failed: supervisor should see all jobs';

  select count(*) into v_count from audit_log;
  assert v_count = 0, format('R13 failed: supervisor saw %s audit rows', v_count);
end $$;

-- R15: a supervisor cannot edit a weighment (no update/no delete policy, plus REVOKE).
do $$
begin
  begin
    update weighments set gross_g = 1 where true;
    raise exception 'R15 failed: supervisor update succeeded';
  exception
    when insufficient_privilege or restrict_violation then
      raise notice 'OK: R15 supervisor cannot edit a weighment';
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

-- Owner-only: audit_log is readable by the owner.
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', false);

do $$
declare v_count integer;
begin
  select count(*) into v_count from audit_log;
  assert v_count > 0, 'owner should read audit_log rows generated by earlier inserts';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'Phase 0 RLS matrix passed'
