-- Enable RLS on every table, then add policies. A table with RLS enabled and no
-- policy is closed to everyone except service_role, which is the correct default.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename not like 'pg_%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Profiles and roles
create policy p_profiles_self on profiles for select to authenticated
  using (id = auth.uid() or is_supervisor_up());
create policy p_profiles_owner_write on profiles for all to authenticated
  using (is_owner()) with check (is_owner());

create policy p_roles_read on user_roles for select to authenticated
  using (profile_id = auth.uid() or is_supervisor_up());
create policy p_roles_owner_write on user_roles for all to authenticated
  using (is_owner()) with check (is_owner());

-- Master data. Everyone reads, owner writes.
do $$
declare t text;
begin
  foreach t in array array['tube_types','packaging','machines','scales','products',
                           'routes','reference_weights','machine_operators'] loop
    execute format($f$
      create policy p_%1$s_read on %1$I for select to authenticated using (true);
      create policy p_%1$s_write on %1$I for all to authenticated
        using (is_owner()) with check (is_owner());
    $f$, t);
  end loop;
end $$;

-- Weighments. Insert only, read own or supervisor. No update or delete policy
-- exists, on purpose.
create policy p_weigh_insert on weighments for insert to authenticated
  with check (actor_id = auth.uid());
create policy p_weigh_read on weighments for select to authenticated
  using (actor_id = auth.uid() or is_supervisor_up());

create policy p_wvoid_read on weighment_voids for select to authenticated
  using (is_supervisor_up());
create policy p_wvoid_write on weighment_voids for insert to authenticated
  with check (is_supervisor_up() and voided_by = auth.uid());

-- Production. An operator sees and touches only their own jobs, on machines they
-- are assigned to.
create policy p_jobs_read on production_jobs for select to authenticated
  using (operator_id = auth.uid() or is_supervisor_up());
create policy p_jobs_insert on production_jobs for insert to authenticated
  with check (
    operator_id = auth.uid()
    and operates_machine(machine_id)
    and has_role('operator')
  );
-- Only while open, and only your own.
create policy p_jobs_update on production_jobs for update to authenticated
  using (operator_id = auth.uid() and status = 'open')
  with check (operator_id = auth.uid());

create policy p_jobs_sup_update on production_jobs for update to authenticated
  using (is_supervisor_up()) with check (is_supervisor_up());

-- Child tables follow the parent.
do $$
declare t text;
begin
  foreach t in array array['job_inputs','job_outputs','job_waste'] loop
    execute format($f$
      create policy p_%1$s_read on %1$I for select to authenticated
        using (exists (select 1 from production_jobs j where j.id = %1$I.job_id
               and (j.operator_id = auth.uid() or is_supervisor_up())));
      create policy p_%1$s_insert on %1$I for insert to authenticated
        with check (exists (select 1 from production_jobs j where j.id = job_id
               and j.operator_id = auth.uid() and j.status = 'open'));
    $f$, t);
  end loop;
end $$;

-- Raw material. Operators must be able to pick a lot when starting a job. Only a
-- supervisor books stock in.
create policy p_lots_read on raw_lots for select to authenticated using (true);
create policy p_lots_write on raw_lots for all to authenticated
  using (is_supervisor_up()) with check (is_supervisor_up());

-- Inventory. Read is wide, write is system-only. Nothing inserts here directly
-- from a client: close_job() and the order RPCs post the moves.
create policy p_moves_read on inventory_moves for select to authenticated using (true);
create policy p_moves_insert on inventory_moves for insert to authenticated
  with check (is_supervisor_up() and actor_id = auth.uid());

-- Sales.
create policy p_cust_read on customers for select to authenticated using (true);
create policy p_cust_write on customers for all to authenticated
  using (has_role('order_taker') or is_supervisor_up())
  with check (has_role('order_taker') or is_supervisor_up());

create policy p_orders_read on orders for select to authenticated
  using (
    is_supervisor_up()
    or taken_by = auth.uid()
    or (has_role('packer') and status in ('confirmed','packed'))
    or drives_trip_for_order(id)
  );
create policy p_orders_insert on orders for insert to authenticated
  with check ((has_role('order_taker') or is_supervisor_up()) and taken_by = auth.uid());
create policy p_orders_update on orders for update to authenticated
  using (
    is_supervisor_up()
    or (has_role('packer') and status = 'confirmed')
    or (taken_by = auth.uid() and status = 'draft')
  );

create policy p_lines_read on order_lines for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id));   -- inherits order RLS
create policy p_lines_write on order_lines for all to authenticated
  using (exists (select 1 from orders o where o.id = order_id
                 and o.status = 'draft' and (o.taken_by = auth.uid() or is_supervisor_up())))
  with check (exists (select 1 from orders o where o.id = order_id
                 and o.status = 'draft' and (o.taken_by = auth.uid() or is_supervisor_up())));

create policy p_pack_read on packing_events for select to authenticated
  using (packer_id = auth.uid() or is_supervisor_up());
create policy p_pack_insert on packing_events for insert to authenticated
  with check (has_role('packer') and packer_id = auth.uid());

-- Delivery. A driver sees their own trip and nothing else. This matters: the
-- delivery list is also a list of every customer and price you have.
create policy p_trips_read on trips for select to authenticated
  using (driver_id = auth.uid() or is_supervisor_up());
create policy p_trips_write on trips for all to authenticated
  using (is_supervisor_up()) with check (is_supervisor_up());

create policy p_stops_read on trip_stops for select to authenticated
  using (exists (select 1 from trips t where t.id = trip_id
                 and (t.driver_id = auth.uid() or is_supervisor_up())));
create policy p_stops_update on trip_stops for update to authenticated
  using (exists (select 1 from trips t where t.id = trip_id and t.driver_id = auth.uid()))
  with check (status in ('delivered','partial','refused','skipped'));
create policy p_stops_sup on trip_stops for all to authenticated
  using (is_supervisor_up()) with check (is_supervisor_up());

create policy p_pay_read on payments for select to authenticated
  using (collected_by = auth.uid() or is_supervisor_up());
create policy p_pay_insert on payments for insert to authenticated
  with check (collected_by = auth.uid());
create policy p_pay_deposit on payments for update to authenticated
  using (is_supervisor_up()) with check (is_supervisor_up());

-- Quality and flags.
create policy p_cal_read on calibration_checks for select to authenticated using (true);
create policy p_cal_insert on calibration_checks for insert to authenticated
  with check (checked_by = auth.uid());

create policy p_cc_read on cycle_counts for select to authenticated using (is_supervisor_up());
create policy p_cc_insert on cycle_counts for insert to authenticated
  with check (is_supervisor_up() and counted_by = auth.uid());

create policy p_flags_read on flags for select to authenticated using (is_supervisor_up());
create policy p_flags_update on flags for update to authenticated
  using (is_supervisor_up()) with check (is_supervisor_up());
-- Flags are raised only by SECURITY DEFINER functions. No insert policy.

create policy p_audit_read on audit_log for select to authenticated using (is_owner());
