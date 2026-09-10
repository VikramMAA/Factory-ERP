do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')
    then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')
    then create role service_role nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);

-- Stand-in for Supabase's auth.uid(). In tests, impersonate a user with:
--   set request.jwt.claim.sub = '<uuid>';
create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;

create schema if not exists cron;
create or replace function cron.schedule(job_name text, sched text, cmd text)
  returns bigint language sql as $$ select 1::bigint $$;

grant usage on schema auth, storage to authenticated, anon;
