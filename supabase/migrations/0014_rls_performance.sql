-- The Supabase performance advisor flagged 28 policies re-evaluating
-- auth.uid()/helper functions per row instead of once per query. Wrapping each
-- call as (select ...) lets Postgres treat it as an initplan. No behavior
-- change: same predicates, just evaluated once. See
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- Profiles and roles
drop policy p_profiles_self on profiles;
create policy p_profiles_self on profiles for select to authenticated
  using (id = (select auth.uid()) or (select is_supervisor_up()));
drop policy p_profiles_owner_write on profiles;
create policy p_profiles_owner_write on profiles for all to authenticated
  using ((select is_owner())) with check ((select is_owner()));

drop policy p_roles_read on user_roles;
create policy p_roles_read on user_roles for select to authenticated
  using (profile_id = (select auth.uid()) or (select is_supervisor_up()));
drop policy p_roles_owner_write on user_roles;
create policy p_roles_owner_write on user_roles for all to authenticated
  using ((select is_owner())) with check ((select is_owner()));

-- Master data write policies (read policies are bare `true`, nothing to wrap)
do $$
declare t text;
begin
  foreach t in array array['tube_types','packaging','machines','scales','products',
                           'routes','reference_weights','machine_operators'] loop
    execute format('drop policy p_%1$s_write on %1$I', t);
    execute format($f$
      create policy p_%1$s_write on %1$I for all to authenticated
        using ((select is_owner())) with check ((select is_owner()));
    $f$, t);
  end loop;
end $$;

-- Weighments
drop policy p_weigh_insert on weighments;
create policy p_weigh_insert on weighments for insert to authenticated
  with check (actor_id = (select auth.uid()));
drop policy p_weigh_read on weighments;
create policy p_weigh_read on weighments for select to authenticated
  using (actor_id = (select auth.uid()) or (select is_supervisor_up()));

drop policy p_wvoid_read on weighment_voids;
create policy p_wvoid_read on weighment_voids for select to authenticated
  using ((select is_supervisor_up()));
drop policy p_wvoid_write on weighment_voids;
create policy p_wvoid_write on weighment_voids for insert to authenticated
  with check ((select is_supervisor_up()) and voided_by = (select auth.uid()));

-- Production
drop policy p_jobs_read on production_jobs;
create policy p_jobs_read on production_jobs for select to authenticated
  using (operator_id = (select auth.uid()) or (select is_supervisor_up()));
drop policy p_jobs_insert on production_jobs;
create policy p_jobs_insert on production_jobs for insert to authenticated
  with check (
    operator_id = (select auth.uid())
    and (select operates_machine(machine_id))
    and (select has_role('operator'))
  );
drop policy p_jobs_update on production_jobs;
create policy p_jobs_update on production_jobs for update to authenticated
  using (operator_id = (select auth.uid()) and status = 'open')
  with check (operator_id = (select auth.uid()));
drop policy p_jobs_sup_update on production_jobs;
create policy p_jobs_sup_update on production_jobs for update to authenticated
  using ((select is_supervisor_up())) with check ((select is_supervisor_up()));

do $$
declare t text;
begin
  foreach t in array array['job_inputs','job_outputs','job_waste'] loop
    execute format('drop policy p_%1$s_read on %1$I', t);
    execute format('drop policy p_%1$s_insert on %1$I', t);
    execute format($f$
      create policy p_%1$s_read on %1$I for select to authenticated
        using (exists (select 1 from production_jobs j where j.id = %1$I.job_id
               and (j.operator_id = (select auth.uid()) or (select is_supervisor_up()))));
      create policy p_%1$s_insert on %1$I for insert to authenticated
        with check (exists (select 1 from production_jobs j where j.id = job_id
               and j.operator_id = (select auth.uid()) and j.status = 'open'));
    $f$, t);
  end loop;
end $$;

-- Raw material
drop policy p_lots_write on raw_lots;
create policy p_lots_write on raw_lots for all to authenticated
  using ((select is_supervisor_up())) with check ((select is_supervisor_up()));

-- Inventory
drop policy p_moves_insert on inventory_moves;
create policy p_moves_insert on inventory_moves for insert to authenticated
  with check ((select is_supervisor_up()) and actor_id = (select auth.uid()));

-- Sales
drop policy p_cust_write on customers;
create policy p_cust_write on customers for all to authenticated
  using ((select has_role('order_taker')) or (select is_supervisor_up()))
  with check ((select has_role('order_taker')) or (select is_supervisor_up()));

drop policy p_orders_read on orders;
create policy p_orders_read on orders for select to authenticated
  using (
    (select is_supervisor_up())
    or taken_by = (select auth.uid())
    or ((select has_role('packer')) and status in ('confirmed','packed'))
    or (select drives_trip_for_order(id))
  );
drop policy p_orders_insert on orders;
create policy p_orders_insert on orders for insert to authenticated
  with check (((select has_role('order_taker')) or (select is_supervisor_up())) and taken_by = (select auth.uid()));
drop policy p_orders_update on orders;
create policy p_orders_update on orders for update to authenticated
  using (
    (select is_supervisor_up())
    or ((select has_role('packer')) and status = 'confirmed')
    or (taken_by = (select auth.uid()) and status = 'draft')
  );

drop policy p_lines_write on order_lines;
create policy p_lines_write on order_lines for all to authenticated
  using (exists (select 1 from orders o where o.id = order_id
                 and o.status = 'draft' and (o.taken_by = (select auth.uid()) or (select is_supervisor_up()))))
  with check (exists (select 1 from orders o where o.id = order_id
                 and o.status = 'draft' and (o.taken_by = (select auth.uid()) or (select is_supervisor_up()))));

drop policy p_pack_read on packing_events;
create policy p_pack_read on packing_events for select to authenticated
  using (packer_id = (select auth.uid()) or (select is_supervisor_up()));
drop policy p_pack_insert on packing_events;
create policy p_pack_insert on packing_events for insert to authenticated
  with check ((select has_role('packer')) and packer_id = (select auth.uid()));

-- Delivery
drop policy p_trips_read on trips;
create policy p_trips_read on trips for select to authenticated
  using (driver_id = (select auth.uid()) or (select is_supervisor_up()));
drop policy p_trips_write on trips;
create policy p_trips_write on trips for all to authenticated
  using ((select is_supervisor_up())) with check ((select is_supervisor_up()));

drop policy p_stops_read on trip_stops;
create policy p_stops_read on trip_stops for select to authenticated
  using (exists (select 1 from trips t where t.id = trip_id
                 and (t.driver_id = (select auth.uid()) or (select is_supervisor_up()))));
drop policy p_stops_update on trip_stops;
create policy p_stops_update on trip_stops for update to authenticated
  using (exists (select 1 from trips t where t.id = trip_id and t.driver_id = (select auth.uid())))
  with check (status in ('delivered','partial','refused','skipped'));
drop policy p_stops_sup on trip_stops;
create policy p_stops_sup on trip_stops for all to authenticated
  using ((select is_supervisor_up())) with check ((select is_supervisor_up()));

drop policy p_pay_read on payments;
create policy p_pay_read on payments for select to authenticated
  using (collected_by = (select auth.uid()) or (select is_supervisor_up()));
drop policy p_pay_insert on payments;
create policy p_pay_insert on payments for insert to authenticated
  with check (collected_by = (select auth.uid()));
drop policy p_pay_deposit on payments;
create policy p_pay_deposit on payments for update to authenticated
  using ((select is_supervisor_up())) with check ((select is_supervisor_up()));

-- Quality and flags
drop policy p_cal_insert on calibration_checks;
create policy p_cal_insert on calibration_checks for insert to authenticated
  with check (checked_by = (select auth.uid()));

drop policy p_cc_read on cycle_counts;
create policy p_cc_read on cycle_counts for select to authenticated using ((select is_supervisor_up()));
drop policy p_cc_insert on cycle_counts;
create policy p_cc_insert on cycle_counts for insert to authenticated
  with check ((select is_supervisor_up()) and counted_by = (select auth.uid()));

drop policy p_flags_read on flags;
create policy p_flags_read on flags for select to authenticated using ((select is_supervisor_up()));
drop policy p_flags_update on flags;
create policy p_flags_update on flags for update to authenticated
  using ((select is_supervisor_up())) with check ((select is_supervisor_up()));
