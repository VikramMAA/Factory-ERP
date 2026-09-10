-- SPEC.md Phase 5. A client error log (not in SPEC.md's own schema, but
-- Section 13 Phase 5 explicitly asks for "an error boundary and a client
-- error log table"), and a storage-usage helper for the dashboard tile.

create table client_error_log (
  id          bigserial primary key,
  message     text not null,
  stack       text,
  url         text,
  user_id     uuid references profiles(id),
  created_at  timestamptz not null default now()
);
alter table client_error_log enable row level security;
revoke all on client_error_log from anon;

-- Anyone signed in can log their own crash; only an owner needs to see the
-- backlog. No update or delete policy: like weighments, a client error
-- report is not something a client should be able to edit after the fact.
create policy p_error_log_insert on client_error_log for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);
create policy p_error_log_read on client_error_log for select to authenticated
  using ((select is_owner()));
revoke update, delete on client_error_log from authenticated;

create trigger trg_client_error_log_audit after insert on client_error_log
  for each row execute function fn_audit();

-- Approximate storage usage for the free-tier warning tile (SPEC.md Section
-- 2: 1 GB file storage on Supabase Free). storage.objects isn't something a
-- client can query directly (Supabase's own storage RLS applies, and this
-- app never grants client access to that schema) — a SECURITY DEFINER
-- function is the only way to expose an aggregate without opening the
-- underlying table up.
create or replace function fn_storage_usage_bytes() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
  from storage.objects
  where bucket_id = 'weighment-photos';
$$;
revoke all on function fn_storage_usage_bytes() from public, anon;
grant execute on function fn_storage_usage_bytes() to authenticated;
