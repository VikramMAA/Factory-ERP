-- Phase 2 acceptance criteria: v_stock reflects inventory_moves correctly,
-- and a cycle count variance raises exactly one flag, with a second
-- identical count not producing a second one.

\set ON_ERROR_STOP on

do $$
declare
  v_sup uuid := gen_random_uuid();
  v_product uuid;
begin
  insert into auth.users (id, email) values (v_sup, 'stock_sup@rewind.local');
  insert into profiles (id, username, full_name) values (v_sup, 'stock_sup', 'Stock Supervisor');
  insert into user_roles (profile_id, role) values (v_sup, 'supervisor');

  select id into v_product from products where code = 'HW-100'; -- untouched by 40_close_job.sql

  create temporary table _stock_ids (name text primary key, id uuid);
  insert into _stock_ids values ('sup', v_sup), ('product', v_product);
end $$;

select id as sup_id from _stock_ids where name = 'sup' \gset
select id as product_id from _stock_ids where name = 'product' \gset
select set_config('test.sup_id', :'sup_id', false);
select set_config('test.product_id', :'product_id', false);

-- v_stock reflects a manual opening-balance move correctly.
do $$
declare v_qty integer; v_weight integer;
begin
  insert into inventory_moves (product_id, qty_delta, weight_delta_g, reason, actor_id)
  values (current_setting('test.product_id')::uuid, 200, 20000, 'opening', current_setting('test.sup_id')::uuid);

  select qty_on_hand, weight_on_hand_g into v_qty, v_weight from v_stock
  where product_id = current_setting('test.product_id')::uuid;
  assert v_qty = 200, format('expected 200 on hand, got %s', v_qty);
  assert v_weight = 20000, format('expected 20000 g on hand, got %s', v_weight);
  raise notice 'OK: v_stock reflects inventory_moves';
end $$;

-- A cycle count with a variance produces exactly one flag; a second
-- identical count does not produce a second one (the partial unique index
-- on open flags dedupes by product, matching SPEC.md Section 9's design).
do $$
declare v_system_qty integer; v_flags integer;
begin
  select qty_on_hand into v_system_qty from v_stock where product_id = current_setting('test.product_id')::uuid;

  insert into cycle_counts (product_id, counted_qty, system_qty, counted_by)
  values (current_setting('test.product_id')::uuid, v_system_qty - 15, v_system_qty, current_setting('test.sup_id')::uuid);

  select count(*) into v_flags from flags
  where code = 'CYCLE_COUNT_VARIANCE' and entity_id = current_setting('test.product_id')::uuid;
  assert v_flags = 1, format('expected exactly 1 variance flag, got %s', v_flags);

  insert into cycle_counts (product_id, counted_qty, system_qty, counted_by)
  values (current_setting('test.product_id')::uuid, v_system_qty - 15, v_system_qty, current_setting('test.sup_id')::uuid);

  select count(*) into v_flags from flags
  where code = 'CYCLE_COUNT_VARIANCE' and entity_id = current_setting('test.product_id')::uuid;
  assert v_flags = 1, format('a second identical count should not add a flag, got %s', v_flags);

  raise notice 'OK: cycle count variance flags exactly once';
end $$;

-- A cycle count matching the system exactly raises no flag at all.
do $$
declare v_system_qty integer; v_before integer; v_after integer;
begin
  select qty_on_hand into v_system_qty from v_stock where product_id = current_setting('test.product_id')::uuid;
  select count(*) into v_before from flags where code = 'CYCLE_COUNT_VARIANCE';

  insert into cycle_counts (product_id, counted_qty, system_qty, counted_by)
  values (current_setting('test.product_id')::uuid, v_system_qty, v_system_qty, current_setting('test.sup_id')::uuid);

  select count(*) into v_after from flags where code = 'CYCLE_COUNT_VARIANCE';
  assert v_after = v_before, 'a matching count should raise no flag';
  raise notice 'OK: a matching count raises no flag';
end $$;

\echo 'Phase 2 stock checks passed'
