insert into tube_types (code, name, tare_g) values
  ('TT-S', 'Small plastic tube', 4),
  ('TT-M', 'Medium plastic tube', 7),
  ('TT-P', 'Paper core', 3);

insert into packaging (code, name, kind, tare_g) values
  ('BOX-L', 'Large carton',  'box',   420),
  ('BOX-S', 'Small carton',  'box',   180),
  ('CVR-1', 'Plastic cover', 'cover',  25),
  ('TRAY-1','Steel tray',    'tray',  900);

insert into machines (code, name) values
  ('M1','Winder 1'), ('M2','Winder 2'), ('M3','Winder 3');

insert into scales (code, location, capacity_g) values
  ('SC-1','Production floor', 60000),
  ('SC-2','Packing bench', 30000);

insert into reference_weights (code, nominal_g) values ('REF-5K', 5000);

insert into products (code, name, category, tube_type_id, target_net_g,
                      tolerance_pct, target_yield_pct, price_floor_paise) values
  ('SB-20', 'Stitching bobbin 20g', 'stitching_bobbin',
     (select id from tube_types where code='TT-S'), 20, 3.0, 96.0, 1200),
  ('SB-50', 'Stitching bobbin 50g', 'stitching_bobbin',
     (select id from tube_types where code='TT-M'), 50, 3.0, 96.0, 2600),
  ('HW-100','Hotel wrap thread 100g', 'hotel_wrap',
     (select id from tube_types where code='TT-P'), 100, 4.0, 95.0, 4500),
  ('RL-10', 'Religious thread 10g', 'religious',
     (select id from tube_types where code='TT-S'), 10, 5.0, 94.0, 700);

insert into routes (name) values ('North'), ('South'), ('Market');

-- Test users are created through Supabase Auth (email confirmation disabled), not
-- here. See README for the synthetic addresses (operator1@rewind.local etc).
