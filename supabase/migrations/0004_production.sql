create table weighments (
  id           uuid primary key default gen_random_uuid(),
  client_uuid  uuid not null unique,              -- idempotency key from the offline queue
  kind         weighment_kind not null,
  gross_g      integer not null check (gross_g > 0),
  scale_id     uuid references scales(id),
  photo_path   text not null,
  photo_sha256 char(64) not null,                 -- indexed, not unique: collisions are flagged, not blocked
  device_ts    timestamptz not null,              -- phone clock, untrusted
  server_ts    timestamptz not null default now(),-- forced by trigger, trusted
  lat          double precision,
  lng          double precision,
  accuracy_m   real,
  actor_id     uuid not null references profiles(id),  -- forced to auth.uid() by trigger
  note         text
);
create index on weighments (photo_sha256);
create index on weighments (actor_id, server_ts desc);
create index on weighments (kind, server_ts desc);

-- Corrections never edit a weighment. They void it and add a new one.
create table weighment_voids (
  weighment_id uuid primary key references weighments(id),
  voided_by    uuid not null references profiles(id),
  reason       text not null check (length(trim(reason)) >= 10),
  replaced_by  uuid references weighments(id),
  at           timestamptz not null default now()
);

-- A job is a run of one product on one machine by one operator. Inputs, outputs and
-- waste are child rows because a shift produces continuously, not in one lump.
create table production_jobs (
  id          uuid primary key default gen_random_uuid(),
  job_no      bigserial not null unique,
  machine_id  uuid not null references machines(id),
  operator_id uuid not null references profiles(id),
  product_id  uuid not null references products(id),
  shift       text check (shift in ('day','night')),
  status      job_status not null default 'open',
  started_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid references profiles(id),

  -- Rollups written by close_job(). Null while open.
  input_g       integer,
  output_units  integer,
  output_net_g  integer,
  waste_g       integer,

  yield_pct numeric(6,3) generated always as (
    case when input_g > 0 and output_net_g is not null
         then round(output_net_g::numeric * 100 / input_g, 3) end
  ) stored,

  waste_pct numeric(6,3) generated always as (
    case when input_g > 0 and waste_g is not null
         then round(waste_g::numeric * 100 / input_g, 3) end
  ) stored,

  -- The money line. Declared waste is separated from unexplained loss on purpose:
  -- an operator inflating waste moves waste_pct; an operator removing tubes moves this.
  unaccounted_pct numeric(6,3) generated always as (
    case when input_g > 0 and output_net_g is not null and waste_g is not null
         then round(100 - (output_net_g + waste_g)::numeric * 100 / input_g, 3) end
  ) stored,

  created_at timestamptz not null default now()
);
create index on production_jobs (product_id, machine_id, closed_at desc) where status = 'closed';
create index on production_jobs (operator_id, closed_at desc) where status = 'closed';

create table job_inputs (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references production_jobs(id) on delete restrict,
  raw_lot_id   uuid not null references raw_lots(id),
  weight_g     integer not null check (weight_g > 0),
  weighment_id uuid not null references weighments(id),
  at           timestamptz not null default now()
);

create table job_outputs (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references production_jobs(id) on delete restrict,
  unit_count     integer not null check (unit_count > 0),
  gross_g        integer not null check (gross_g > 0),
  tube_tare_g    integer not null check (tube_tare_g >= 0),  -- unit_count * tube_types.tare_g
  other_tare_g   integer not null default 0 check (other_tare_g >= 0), -- tray, crate
  net_g          integer generated always as (gross_g - tube_tare_g - other_tare_g) stored,
  weighment_id   uuid not null references weighments(id),
  at             timestamptz not null default now()
);

create table job_waste (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references production_jobs(id) on delete restrict,
  weight_g     integer not null check (weight_g > 0),
  reason       text,
  weighment_id uuid not null references weighments(id),
  at           timestamptz not null default now()
);
