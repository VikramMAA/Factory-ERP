-- Phase 0 user-management checks: the last-owner guard and the deactivation
-- gap closed in 0015 (a deactivated account losing its ability to act through
-- identity-only policies, not just role-gated ones).

\set ON_ERROR_STOP on

do $$
declare
  v_owner1 uuid := gen_random_uuid();
  v_owner2 uuid := gen_random_uuid();
  v_operator uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (v_owner1, 'ownerA@rewind.local'),
    (v_owner2, 'ownerB@rewind.local'),
    (v_operator, 'operatorX@rewind.local');

  insert into profiles (id, username, full_name) values
    (v_owner1, 'ownera', 'Owner A'),
    (v_owner2, 'ownerb', 'Owner B'),
    (v_operator, 'operatorx', 'Operator X');

  insert into user_roles (profile_id, role) values
    (v_owner1, 'owner'), (v_owner2, 'owner'), (v_operator, 'operator');

  create temporary table _um_ids (name text primary key, id uuid);
  insert into _um_ids values ('owner1', v_owner1), ('owner2', v_owner2), ('operator', v_operator);
end $$;

-- Earlier test files in this same scratch database (20_rls.sql) created their
-- own owner profiles. Deactivate those now, with owner1/owner2 above already
-- active as a buffer, so this file's "last owner" checks are scoped to just
-- the two owners it created rather than the whole table.
update profiles set is_active = false
where id not in (select id from _um_ids)
  and id in (select profile_id from user_roles where role = 'owner');

select id as owner1_id from _um_ids where name = 'owner1' \gset
select id as owner2_id from _um_ids where name = 'owner2' \gset
select id as operator_id from _um_ids where name = 'operator' \gset

select set_config('test.owner1_id', :'owner1_id', false);
select set_config('test.owner2_id', :'owner2_id', false);
select set_config('test.operator_id', :'operator_id', false);

-- With two active owners, removing one owner's role is fine.
do $$
begin
  delete from user_roles where profile_id = current_setting('test.owner2_id')::uuid and role = 'owner';
  raise notice 'OK: removing one of two owners succeeded';
end $$;

-- Now only owner1 remains. Removing their owner role must be refused.
do $$
begin
  begin
    delete from user_roles where profile_id = current_setting('test.owner1_id')::uuid and role = 'owner';
    raise exception 'expected restrict_violation, delete succeeded';
  exception
    when restrict_violation then
      raise notice 'OK: cannot remove the last active owner';
  end;
end $$;

-- Deactivating the last owner must also be refused.
do $$
begin
  begin
    update profiles set is_active = false where id = current_setting('test.owner1_id')::uuid;
    raise exception 'expected restrict_violation, deactivate succeeded';
  exception
    when restrict_violation then
      raise notice 'OK: cannot deactivate the last active owner';
  end;
end $$;

-- Deactivation closes the identity-only-policy gap: a deactivated operator
-- can no longer insert a weighment as themselves, even though p_weigh_insert
-- only checks actor_id = auth.uid() and never calls has_role().
update profiles set is_active = false where id = current_setting('test.operator_id')::uuid;

set role authenticated;
select set_config('request.jwt.claim.sub', :'operator_id', false);

do $$
begin
  begin
    insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
    values (gen_random_uuid(), 'calibration', 5000, '2026/01/z.jpg', repeat('c', 64), now(),
            current_setting('test.operator_id')::uuid);
    raise exception 'expected RLS violation, insert succeeded for a deactivated user';
  exception
    when insufficient_privilege or others then
      raise notice 'OK: a deactivated user cannot insert a weighment';
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'Phase 0 user-management checks passed'
