-- Phase 3 acceptance criteria: price floor enforcement, driver trip
-- isolation, and a short delivery returning stock + raising exactly one flag.

\set ON_ERROR_STOP on

do $$
declare
  v_sup uuid := gen_random_uuid();
  v_taker uuid := gen_random_uuid();
  v_packer uuid := gen_random_uuid();
  v_driver1 uuid := gen_random_uuid();
  v_driver2 uuid := gen_random_uuid();
  v_product uuid; v_customer uuid;
begin
  insert into auth.users (id, email) values
    (v_sup, 'sd_sup@rewind.local'), (v_taker, 'sd_taker@rewind.local'),
    (v_packer, 'sd_packer@rewind.local'), (v_driver1, 'sd_driver1@rewind.local'),
    (v_driver2, 'sd_driver2@rewind.local');

  insert into profiles (id, username, full_name) values
    (v_sup, 'sd_sup', 'SD Supervisor'), (v_taker, 'sd_taker', 'SD Order Taker'),
    (v_packer, 'sd_packer', 'SD Packer'), (v_driver1, 'sd_driver1', 'SD Driver One'),
    (v_driver2, 'sd_driver2', 'SD Driver Two');

  insert into user_roles (profile_id, role) values
    (v_sup, 'supervisor'), (v_taker, 'order_taker'), (v_packer, 'packer'),
    (v_driver1, 'driver'), (v_driver2, 'driver');

  select id into v_product from products where code = 'SB-50'; -- price_floor_paise 2600
  insert into customers (code, shop_name) values ('CUST-SD-1', 'Test Shop') returning id into v_customer;

  create temporary table _sd_ids (name text primary key, id uuid);
  insert into _sd_ids values
    ('sup', v_sup), ('taker', v_taker), ('packer', v_packer),
    ('driver1', v_driver1), ('driver2', v_driver2),
    ('product', v_product), ('customer', v_customer);
end $$;

select id as sup_id from _sd_ids where name = 'sup' \gset
select id as taker_id from _sd_ids where name = 'taker' \gset
select id as packer_id from _sd_ids where name = 'packer' \gset
select id as driver1_id from _sd_ids where name = 'driver1' \gset
select id as driver2_id from _sd_ids where name = 'driver2' \gset
select id as product_id from _sd_ids where name = 'product' \gset
select id as customer_id from _sd_ids where name = 'customer' \gset

select set_config('test.sup_id', :'sup_id', false);
select set_config('test.taker_id', :'taker_id', false);
select set_config('test.packer_id', :'packer_id', false);
select set_config('test.driver1_id', :'driver1_id', false);
select set_config('test.driver2_id', :'driver2_id', false);
select set_config('test.product_id', :'product_id', false);
select set_config('test.customer_id', :'customer_id', false);

-- Give both drivers some stock to actually deliver: post an opening balance.
do $$
begin
  insert into inventory_moves (product_id, qty_delta, weight_delta_g, reason, actor_id)
  values (current_setting('test.product_id')::uuid, 1000, 50000, 'opening', current_setting('test.sup_id')::uuid);
end $$;

-- 11: a below-floor line is rejected without an approver; the same line with
-- a valid supervisor approver is accepted and flagged.
do $$
declare v_order uuid;
begin
  insert into orders (customer_id, taken_by, channel)
  values (current_setting('test.customer_id')::uuid, current_setting('test.taker_id')::uuid, 'phone')
  returning id into v_order;

  begin
    insert into order_lines (order_id, product_id, qty, unit_price_paise)
    values (v_order, current_setting('test.product_id')::uuid, 10, 2000); -- floor is 2600
    raise exception 'expected check_violation, below-floor insert succeeded with no approver';
  exception
    when others then
      if sqlerrm not like '%Supervisor approval is required%' then raise; end if;
      raise notice 'OK: below-floor price rejected without an approver';
  end;

  insert into order_lines (order_id, product_id, qty, unit_price_paise, approved_by)
  values (v_order, current_setting('test.product_id')::uuid, 10, 2000, current_setting('test.sup_id')::uuid);

  perform 1 from flags where code = 'PRICE_BELOW_FLOOR' and entity_type = 'order_line';
  assert found, 'expected a PRICE_BELOW_FLOOR flag once an approver is set';
  raise notice 'OK: below-floor price accepted with a supervisor approver, and flagged';
end $$;

-- Full dispatch/deliver flow, short by 2 units.
do $$
declare v_order uuid; v_trip uuid; v_stop uuid;
  v_stock_before integer; v_stock_after integer; v_flags_before integer; v_flags_after integer;
begin
  insert into orders (customer_id, taken_by, channel, status)
  values (current_setting('test.customer_id')::uuid, current_setting('test.taker_id')::uuid, 'phone', 'confirmed')
  returning id into v_order;
  insert into order_lines (order_id, product_id, qty, unit_price_paise)
  values (v_order, current_setting('test.product_id')::uuid, 20, 3000); -- at/above floor, no approval needed

  insert into trips (driver_id) values (current_setting('test.driver1_id')::uuid) returning id into v_trip;
  insert into trip_stops (trip_id, order_id, seq) values (v_trip, v_order, 1) returning id into v_stop;

  select qty_on_hand into v_stock_before from v_stock where product_id = current_setting('test.product_id')::uuid;

  -- dispatch_trip and deliver_stop check is_supervisor_up()/driver_id against
  -- auth.uid() internally, which reads request.jwt.claim.sub — being
  -- postgres bypasses RLS but not this explicit in-function permission
  -- check, so we impersonate for the duration of each call.
  perform set_config('request.jwt.claim.sub', current_setting('test.sup_id'), true);
  perform dispatch_trip(v_trip);

  select qty_on_hand into v_stock_after from v_stock where product_id = current_setting('test.product_id')::uuid;
  assert v_stock_before - v_stock_after = 20, format('dispatch should move stock down by 20, moved by %s', v_stock_before - v_stock_after);
  assert (select status from orders where id = v_order) = 'dispatched', 'order should be dispatched';

  select count(*) into v_flags_before from flags where code = 'DELIVERY_SHORTFALL';

  perform set_config('request.jwt.claim.sub', current_setting('test.driver1_id'), true);
  perform deliver_stop(v_stop, 18, 'Shop Owner', '2026/01/proof.jpg', 0);
  perform set_config('request.jwt.claim.sub', '', true);

  select qty_on_hand into v_stock_after from v_stock where product_id = current_setting('test.product_id')::uuid;
  assert v_stock_before - v_stock_after = 18, format('short delivery should return 2 units to stock, net move is %s', v_stock_before - v_stock_after);
  assert (select status from trip_stops where id = v_stop) = 'partial', 'stop should be partial';
  assert (select status from orders where id = v_order) = 'delivered', 'order should be delivered';

  select count(*) into v_flags_after from flags where code = 'DELIVERY_SHORTFALL';
  assert v_flags_after - v_flags_before = 1, format('expected exactly 1 new DELIVERY_SHORTFALL flag, got %s', v_flags_after - v_flags_before);

  raise notice 'OK: short delivery returns stock and raises exactly one DELIVERY_SHORTFALL flag';
end $$;

-- R: a driver reads their own trip's stops and gets zero rows for another
-- driver's trip.
set role authenticated;
select set_config('request.jwt.claim.sub', :'driver2_id', false);
do $$
declare v_count integer;
begin
  select count(*) into v_count from trip_stops;
  assert v_count = 0, format('driver2 should see 0 stops (has no trips), saw %s', v_count);
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

set role authenticated;
select set_config('request.jwt.claim.sub', :'driver1_id', false);
do $$
declare v_count integer;
begin
  select count(*) into v_count from trip_stops;
  assert v_count >= 1, 'driver1 should see their own stop';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- pack_order: a packer can transition confirmed -> packed; the same order
-- cannot be packed twice; a non-packer, non-supervisor cannot call it at all.
do $$
declare v_order uuid; v_weighment uuid; v_packaging uuid;
begin
  insert into orders (customer_id, taken_by, channel, status)
  values (current_setting('test.customer_id')::uuid, current_setting('test.taker_id')::uuid, 'phone', 'confirmed')
  returning id into v_order;
  insert into order_lines (order_id, product_id, qty, unit_price_paise)
  values (v_order, current_setting('test.product_id')::uuid, 5, 3000);

  select id into v_packaging from packaging where code = 'BOX-S';
  insert into weighments (client_uuid, kind, gross_g, photo_path, photo_sha256, device_ts, actor_id)
  values (gen_random_uuid(), 'pack', 5000, '2026/01/pack.jpg', encode(gen_random_bytes(32), 'hex'), now(),
          current_setting('test.packer_id')::uuid)
  returning id into v_weighment;

  perform set_config('request.jwt.claim.sub', current_setting('test.packer_id'), true);
  perform pack_order(v_order, v_packaging, 5, v_weighment);
  assert (select status from orders where id = v_order) = 'packed', 'order should be packed';

  begin
    perform pack_order(v_order, v_packaging, 5, v_weighment);
    raise exception 'expected check_violation, packing an already-packed order succeeded';
  exception
    when others then
      if sqlerrm not like '%not confirmed%' then raise; end if;
      raise notice 'OK: an already-packed order cannot be packed again';
  end;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'taker_id', false); -- order_taker has neither packer nor supervisor role
do $$
declare v_order uuid;
begin
  select id into v_order from orders limit 1;
  begin
    perform pack_order(v_order, (select id from packaging limit 1), 1, (select id from weighments limit 1));
    raise exception 'expected insufficient_privilege, non-packer pack_order succeeded';
  exception
    when insufficient_privilege then
      raise notice 'OK: a non-packer, non-supervisor cannot call pack_order';
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'Phase 3 sales/delivery checks passed'
