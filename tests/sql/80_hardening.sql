-- Phase 5: client_error_log RLS and fn_storage_usage_bytes.

\set ON_ERROR_STOP on

do $$
declare v_owner uuid := gen_random_uuid(); v_op uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_owner, 'hard_owner@rewind.local'), (v_op, 'hard_op@rewind.local');
  insert into profiles (id, username, full_name) values
    (v_owner, 'hard_owner', 'Hardening Owner'), (v_op, 'hard_op', 'Hardening Operator');
  insert into user_roles (profile_id, role) values (v_owner, 'owner'), (v_op, 'operator');

  create temporary table _hard_ids (name text primary key, id uuid);
  insert into _hard_ids values ('owner', v_owner), ('op', v_op);
end $$;

select id as owner_id from _hard_ids where name = 'owner' \gset
select id as op_id from _hard_ids where name = 'op' \gset
select set_config('test.owner_id', :'owner_id', false);
select set_config('test.op_id', :'op_id', false);

-- An operator can log their own crash, and cannot read the backlog.
set role authenticated;
select set_config('request.jwt.claim.sub', :'op_id', false);
do $$
begin
  insert into client_error_log (message, stack, url, user_id)
  values ('TypeError: x is undefined', 'at foo (bar.js:1)', '/job/new', current_setting('test.op_id')::uuid);

  declare v_count integer;
  begin
    select count(*) into v_count from client_error_log;
    assert v_count = 0, format('operator should not read the error log backlog, saw %s', v_count);
  end;
  raise notice 'OK: operator can log their own crash but cannot read the backlog';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- An owner can read the backlog.
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', false);
do $$
declare v_count integer;
begin
  select count(*) into v_count from client_error_log;
  assert v_count >= 1, 'owner should read the error log backlog';
  raise notice 'OK: owner can read the error log backlog';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- fn_storage_usage_bytes sums the weighment-photos bucket's object sizes.
do $$
declare v_bytes bigint;
begin
  insert into storage.objects (bucket_id, name, metadata) values
    ('weighment-photos', '2026/01/a.jpg', jsonb_build_object('size', 40000)),
    ('weighment-photos', '2026/01/b.jpg', jsonb_build_object('size', 35000)),
    ('other-bucket', 'x.jpg', jsonb_build_object('size', 999999));

  select fn_storage_usage_bytes() into v_bytes;
  assert v_bytes = 75000, format('expected 75000 bytes across the weighment-photos bucket, got %s', v_bytes);
  raise notice 'OK: fn_storage_usage_bytes sums only the weighment-photos bucket';
end $$;

\echo 'Phase 5 hardening checks passed'
