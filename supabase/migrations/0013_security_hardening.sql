-- The Supabase security advisor flagged two real gaps left by 0012_immutability
-- once this schema was applied to a live project (a check our local scratch-DB
-- harness in tests/sql/ has no way to run, since it doesn't replicate Supabase's
-- linter):
--
-- 1. fn_block_mutation / fn_block_closed_job_edit / fn_force_server_fields had no
--    `set search_path`, making them vulnerable to search_path hijacking (a caller
--    creating an object that shadows a catalog function in a schema earlier on
--    their search_path). Every function here should pin it, same as the
--    SECURITY DEFINER functions in 0010 already do.
-- 2. fn_audit is a trigger function (`returns trigger`) that Postgres will refuse
--    to run outside trigger context, but SECURITY DEFINER + default grants still
--    made it reachable at /rest/v1/rpc/fn_audit. Revoke execute from anon and
--    authenticated: it should only ever fire as a trigger, as postgres.

create or replace function fn_block_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception
    'Table % is append-only. Post a reversing or voiding entry instead of editing row %.',
    tg_table_name, coalesce(old.id::text, '?')
    using errcode = 'restrict_violation';
end $$;

create or replace function fn_block_closed_job_edit() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'closed' and new.status = 'closed' then
    raise exception 'Job % is closed. Raise a correction job instead.', old.job_no
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create or replace function fn_force_server_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  new.server_ts := now();
  if auth.uid() is not null then
    new.actor_id := auth.uid();
  end if;
  return new;
end $$;

revoke all on function fn_audit() from public, anon, authenticated;
