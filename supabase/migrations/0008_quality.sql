create table reference_weights (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  nominal_g integer not null check (nominal_g > 0)
);

-- Daily one-minute task. Without it you cannot tell scale drift from theft,
-- and you will eventually accuse an honest person.
create table calibration_checks (
  id                  uuid primary key default gen_random_uuid(),
  scale_id            uuid not null references scales(id),
  reference_weight_id uuid not null references reference_weights(id),
  observed_g          integer not null check (observed_g > 0),
  nominal_g           integer not null,
  deviation_g         integer generated always as (observed_g - nominal_g) stored,
  weighment_id        uuid not null references weighments(id),
  checked_by          uuid not null references profiles(id),
  checked_at          timestamptz not null default now()
);
create index on calibration_checks (scale_id, checked_at desc);

-- Off-book sales are invisible to yield analysis. Only a physical count finds them.
create table cycle_counts (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id),
  counted_qty     integer not null check (counted_qty >= 0),
  counted_weight_g integer,
  system_qty      integer not null,
  variance_qty    integer generated always as (counted_qty - system_qty) stored,
  weighment_id    uuid references weighments(id),
  counted_by      uuid not null references profiles(id),
  counted_at      timestamptz not null default now(),
  note            text
);
