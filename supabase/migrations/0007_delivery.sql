create table trips (
  id         uuid primary key default gen_random_uuid(),
  trip_no    bigserial not null unique,
  driver_id  uuid not null references profiles(id),
  vehicle    text,
  trip_date  date not null default current_date,
  status     trip_status not null default 'planned',
  started_at timestamptz,
  ended_at   timestamptz
);

create table trip_stops (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references trips(id) on delete cascade,
  order_id            uuid not null references orders(id),
  seq                 integer not null,
  status              stop_status not null default 'pending',
  dispatched_qty      integer,
  delivered_qty       integer,
  receiver_name       text,
  proof_photo_path    text,
  cash_collected_paise bigint not null default 0,
  delivered_at        timestamptz,
  lat                 double precision,
  lng                 double precision,
  unique (trip_id, seq)
);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id),
  order_id     uuid references orders(id),
  amount_paise bigint not null check (amount_paise > 0),
  mode         payment_mode not null,
  collected_by uuid not null references profiles(id),
  collected_at timestamptz not null default now(),
  deposited_at timestamptz,       -- null means cash is still with the driver
  reference    text
);
create index on payments (collected_by, collected_at desc) where deposited_at is null;
