create table inventory_moves (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id),
  qty_delta      integer not null,          -- signed. positive in, negative out.
  weight_delta_g integer not null default 0,-- signed, same sign as qty_delta
  reason         text not null check (reason in
                   ('production','sale','return','damage','adjustment','cycle_count','opening')),
  ref_type       text,
  ref_id         uuid,
  actor_id       uuid not null references profiles(id),
  at             timestamptz not null default now(),
  note           text
);
create index on inventory_moves (product_id, at desc);
create index on inventory_moves (ref_type, ref_id);
