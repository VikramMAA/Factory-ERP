-- Lets the (anonymous) login screen tell whether the system has ever had an
-- owner, so it can offer a one-time "create the first owner" setup form
-- instead of a login form. This mirrors the admin-users Edge Function's own
-- bootstrap rule (it allows an unauthenticated create_user call only when
-- zero owners exist) — this function just lets the client decide which UI to
-- show; the function itself is what actually enforces the rule.
create or replace function fn_owner_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where role = 'owner');
$$;
revoke all on function fn_owner_exists() from public;
grant execute on function fn_owner_exists() to anon, authenticated;
