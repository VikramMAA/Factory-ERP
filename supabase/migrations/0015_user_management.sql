-- Owner-managed user administration: usernames instead of email, a helper to
-- check "is this caller an active user" (closing a gap where deactivating
-- someone removed their role-based permissions but not their own-row
-- permissions), a guard against locking everyone out by removing the last
-- active owner, and profiles added to the audit trail (a system whose purpose
-- is auditing people should audit changes to who those people are).

-- The login handle. Kept separate from full_name so renaming someone never
-- breaks their ability to sign in.
alter table profiles add column username text unique not null
  check (username = lower(username) and username ~ '^[a-z0-9_]{3,30}$');

create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from profiles where id = auth.uid()), false);
$$;
revoke all on function is_active_user() from public, anon;
grant execute on function is_active_user() to authenticated;

-- Close the deactivation gap: has_role()-gated policies already exclude
-- inactive profiles (it joins profiles and checks is_active), but these
-- policies grant purely on identity match and never called has_role, so a
-- deactivated account could still act through them.
drop policy p_weigh_insert on weighments;
create policy p_weigh_insert on weighments for insert to authenticated
  with check (actor_id = (select auth.uid()) and (select is_active_user()));

drop policy p_cal_insert on calibration_checks;
create policy p_cal_insert on calibration_checks for insert to authenticated
  with check (checked_by = (select auth.uid()) and (select is_active_user()));

drop policy p_pay_insert on payments;
create policy p_pay_insert on payments for insert to authenticated
  with check (collected_by = (select auth.uid()) and (select is_active_user()));

drop policy p_jobs_update on production_jobs;
create policy p_jobs_update on production_jobs for update to authenticated
  using (operator_id = (select auth.uid()) and status = 'open' and (select is_active_user()))
  with check (operator_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['job_inputs','job_outputs','job_waste'] loop
    execute format('drop policy p_%1$s_insert on %1$I', t);
    execute format($f$
      create policy p_%1$s_insert on %1$I for insert to authenticated
        with check (exists (select 1 from production_jobs j where j.id = job_id
               and j.operator_id = (select auth.uid()) and j.status = 'open')
               and (select is_active_user()));
    $f$, t);
  end loop;
end $$;

drop policy p_stops_update on trip_stops;
create policy p_stops_update on trip_stops for update to authenticated
  using (exists (select 1 from trips t where t.id = trip_id and t.driver_id = (select auth.uid()))
         and (select is_active_user()))
  with check (status in ('delivered','partial','refused','skipped'));

drop policy p_lines_write on order_lines;
create policy p_lines_write on order_lines for all to authenticated
  using (exists (select 1 from orders o where o.id = order_id
                 and o.status = 'draft'
                 and ((o.taken_by = (select auth.uid()) and (select is_active_user()))
                      or (select is_supervisor_up()))))
  with check (exists (select 1 from orders o where o.id = order_id
                 and o.status = 'draft'
                 and ((o.taken_by = (select auth.uid()) and (select is_active_user()))
                      or (select is_supervisor_up()))));

-- Refuse to remove or deactivate the last active owner. Recovery from that
-- state means going into the Supabase dashboard directly, which is worth
-- preventing with a cheap trigger.
create or replace function fn_guard_last_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_other_owners integer;
begin
  if tg_table_name = 'user_roles' then
    if old.role <> 'owner' then
      return old;
    end if;
    select count(*) into v_other_owners
    from user_roles ur join profiles p on p.id = ur.profile_id
    where ur.role = 'owner' and p.is_active and ur.profile_id <> old.profile_id;
    if v_other_owners = 0 then
      raise exception 'Cannot remove the last active owner. Assign another owner first.'
        using errcode = 'restrict_violation';
    end if;
    return old;
  else
    if new.is_active = false and old.is_active = true
       and exists (select 1 from user_roles where profile_id = old.id and role = 'owner') then
      select count(*) into v_other_owners
      from user_roles ur join profiles p on p.id = ur.profile_id
      where ur.role = 'owner' and p.is_active and ur.profile_id <> old.id;
      if v_other_owners = 0 then
        raise exception 'Cannot deactivate the last active owner. Assign another owner first.'
          using errcode = 'restrict_violation';
      end if;
    end if;
    return new;
  end if;
end $$;

create trigger trg_guard_last_owner_role before delete on user_roles
  for each row execute function fn_guard_last_owner();
create trigger trg_guard_last_owner_profile before update on profiles
  for each row execute function fn_guard_last_owner();

create trigger trg_profiles_audit after insert or update or delete on profiles
  for each row execute function fn_audit();
