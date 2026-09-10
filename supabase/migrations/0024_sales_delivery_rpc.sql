-- SPEC.md Section 8.3 and 8.4.

create or replace function fn_enforce_price_floor() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_floor integer; v_code text;
begin
  select price_floor_paise, code into v_floor, v_code from products where id = new.product_id;

  if v_floor is not null and new.unit_price_paise < v_floor then
    if new.approved_by is null then
      raise exception
        'Price % for % is below the floor of %. Supervisor approval is required.',
        to_char(new.unit_price_paise / 100.0, 'FM999999990.00'), v_code,
        to_char(v_floor / 100.0, 'FM999999990.00')
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from user_roles
                   where profile_id = new.approved_by and role in ('owner','supervisor')) then
      raise exception 'Approver is not a supervisor or owner.'
        using errcode = 'insufficient_privilege';
    end if;
    perform fn_raise_flag('PRICE_BELOW_FLOOR', 'medium', 'order_line', new.id,
      format('%s sold at %s against a floor of %s', v_code,
             to_char(new.unit_price_paise / 100.0, 'FM999999990.00'),
             to_char(v_floor / 100.0, 'FM999999990.00')),
      jsonb_build_object('price_paise', new.unit_price_paise, 'floor_paise', v_floor,
                         'approved_by', new.approved_by));
  end if;
  return new;
end $$;

create trigger trg_price_floor before insert or update on order_lines
  for each row execute function fn_enforce_price_floor();
revoke all on function fn_enforce_price_floor() from public, anon, authenticated;

create or replace function dispatch_trip(p_trip_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not is_supervisor_up() then
    raise exception 'Only a supervisor can dispatch' using errcode = 'insufficient_privilege';
  end if;

  for s in select ts.id, ts.order_id from trip_stops ts where ts.trip_id = p_trip_id loop
    update trip_stops
      set dispatched_qty = (select sum(qty) from order_lines where order_id = s.order_id)
      where id = s.id;

    insert into inventory_moves(product_id, qty_delta, weight_delta_g, reason,
                                ref_type, ref_id, actor_id)
    select ol.product_id, -ol.qty, -(ol.qty * p.target_net_g), 'sale',
           'order', s.order_id, auth.uid()
    from order_lines ol join products p on p.id = ol.product_id
    where ol.order_id = s.order_id;

    update orders set status = 'dispatched' where id = s.order_id;
  end loop;

  update trips set status = 'out', started_at = now() where id = p_trip_id;
end $$;

create or replace function deliver_stop(
  p_stop_id uuid, p_delivered_qty integer, p_receiver text,
  p_proof_path text, p_cash_paise bigint default 0
) returns void
language plpgsql security definer set search_path = public as $$
declare st trip_stops; ord_id uuid;
begin
  select * into st from trip_stops where id = p_stop_id;
  -- is_active_user() closes the same deactivation gap fixed elsewhere
  -- (0015): the driver branch here checks driver_id directly rather than
  -- through has_role(), which already excludes inactive profiles.
  if not exists (select 1 from trips t where t.id = st.trip_id and t.driver_id = auth.uid()
                 and (select is_active_user()))
     and not is_supervisor_up() then
    raise exception 'Not your stop' using errcode = 'insufficient_privilege';
  end if;

  update trip_stops set
    delivered_qty = p_delivered_qty,
    receiver_name = p_receiver,
    proof_photo_path = p_proof_path,
    cash_collected_paise = p_cash_paise,
    delivered_at = now(),
    -- Same class of bug SPEC.md Appendix C's Gotcha 2 warns about (a CASE
    -- expression is typed text and won't implicitly coerce to an enum
    -- column) — caught live via tests/sql/60_sales_delivery.sql.
    status = (case when p_delivered_qty = st.dispatched_qty then 'delivered'
                   when p_delivered_qty = 0 then 'refused' else 'partial' end)::stop_status
  where id = p_stop_id
  returning order_id into ord_id;

  update orders set status = 'delivered' where id = ord_id;

  if p_cash_paise > 0 then
    insert into payments(customer_id, order_id, amount_paise, mode, collected_by)
    select o.customer_id, o.id, p_cash_paise, 'cash', auth.uid()
    from orders o where o.id = ord_id;
  end if;

  if p_delivered_qty < st.dispatched_qty then
    insert into inventory_moves(product_id, qty_delta, weight_delta_g, reason,
                                ref_type, ref_id, actor_id, note)
    select ol.product_id,
           st.dispatched_qty - p_delivered_qty,
           (st.dispatched_qty - p_delivered_qty) * p.target_net_g,
           'return', 'trip_stop', p_stop_id, auth.uid(), 'short delivery'
    from order_lines ol join products p on p.id = ol.product_id
    where ol.order_id = ord_id
    limit 1;

    perform fn_raise_flag('DELIVERY_SHORTFALL', 'high', 'trip_stop', p_stop_id,
      format('Dispatched %s, delivered %s', st.dispatched_qty, p_delivered_qty),
      jsonb_build_object('dispatched', st.dispatched_qty, 'delivered', p_delivered_qty));
  end if;
end $$;

revoke all on function dispatch_trip(uuid) from public, anon;
grant execute on function dispatch_trip(uuid) to authenticated;
revoke all on function deliver_stop(uuid, integer, text, text, bigint) from public, anon;
grant execute on function deliver_stop(uuid, integer, text, text, bigint) to authenticated;

-- Not in SPEC.md's own RPC list (Section 8), added because the RLS policies
-- as specified make it structurally necessary: p_orders_update has no
-- explicit WITH CHECK, so Postgres reuses the whole USING expression as the
-- check on the NEW row (verified directly: pg_policy.polwithcheck is null
-- for this policy). A packer's own branch requires status = 'confirmed' both
-- before AND after the update — a packer can never flip an order to
-- 'packed' via a plain UPDATE, only a supervisor can (their branch doesn't
-- reference status at all, so it alone satisfies the check regardless of the
-- new status). This mirrors close_job/dispatch_trip/deliver_stop: the
-- transition happens through a SECURITY DEFINER function, atomically with
-- the evidence row it depends on.
create or replace function pack_order(
  p_order_id uuid, p_packaging_id uuid, p_unit_count integer, p_weighment_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare v_status order_status;
begin
  if not (has_role('packer') or is_supervisor_up()) then
    raise exception 'Only a packer can pack an order' using errcode = 'insufficient_privilege';
  end if;
  if not (select is_active_user()) and not is_supervisor_up() then
    raise exception 'Account is not active' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'Order is %, not confirmed', v_status using errcode = 'check_violation';
  end if;

  insert into packing_events (order_id, packer_id, packaging_id, unit_count, weighment_id)
  values (p_order_id, auth.uid(), p_packaging_id, p_unit_count, p_weighment_id);

  update orders set status = 'packed' where id = p_order_id;
end $$;

revoke all on function pack_order(uuid, uuid, integer, uuid) from public, anon;
grant execute on function pack_order(uuid, uuid, integer, uuid) to authenticated;
