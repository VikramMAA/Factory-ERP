create table routes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table customers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  shop_name          text not null,
  contact_name       text,
  phone              text,
  address            text,
  area               text,
  route_id           uuid references routes(id),
  credit_limit_paise bigint not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create table orders (
  id           uuid primary key default gen_random_uuid(),
  order_no     bigserial not null unique,
  customer_id  uuid not null references customers(id),
  status       order_status not null default 'draft',
  channel      text check (channel in ('phone','visit','walkin')),
  taken_by     uuid not null references profiles(id),
  taken_at     timestamptz not null default now(),
  promised_for date,
  notes        text
);
create index on orders (status, taken_at desc);
create index on orders (customer_id, taken_at desc);

create table order_lines (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  product_id       uuid not null references products(id),
  qty              integer not null check (qty > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  line_total_paise bigint generated always as (qty::bigint * unit_price_paise) stored,
  approved_by      uuid references profiles(id),   -- required if below price floor
  approval_reason  text
);

create table packing_events (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id),
  packer_id    uuid not null references profiles(id),
  packaging_id uuid references packaging(id),
  unit_count   integer not null check (unit_count > 0),
  weighment_id uuid not null references weighments(id),
  packed_at    timestamptz not null default now()
);
