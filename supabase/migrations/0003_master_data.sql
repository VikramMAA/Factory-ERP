create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Multiple roles per person. One user can be packer and driver.
create table user_roles (
  profile_id uuid not null references profiles(id) on delete cascade,
  role       user_role not null,
  primary key (profile_id, role)
);

create table tube_types (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  tare_g    integer not null check (tare_g >= 0),
  is_active boolean not null default true,
  -- Tare drift is a silent killer. Re-verify when a new supplier batch arrives.
  tare_verified_at date,
  created_at timestamptz not null default now()
);

create table packaging (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  kind      text not null check (kind in ('box','cover','tray')),
  tare_g    integer not null check (tare_g >= 0),
  is_active boolean not null default true
);

create table machines (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  is_active boolean not null default true
);

create table machine_operators (
  machine_id uuid not null references machines(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  primary key (machine_id, profile_id)
);

create table scales (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  location     text,
  capacity_g   integer not null,
  is_active    boolean not null default true
);

create table products (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  category         product_category not null,
  tube_type_id     uuid references tube_types(id),
  target_net_g     integer not null check (target_net_g > 0),   -- thread per unit, tube excluded
  tolerance_pct    numeric(5,2) not null default 3.0,
  target_yield_pct numeric(5,2) not null default 96.0,
  price_floor_paise integer check (price_floor_paise >= 0),      -- per unit
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table raw_lots (
  id         uuid primary key default gen_random_uuid(),
  lot_code   text not null unique,
  supplier   text,
  material   text,
  count_denier text,
  received_at date not null default current_date,
  gross_g    integer not null check (gross_g > 0),
  tare_g     integer not null default 0 check (tare_g >= 0),
  net_g      integer generated always as (gross_g - tare_g) stored,
  remaining_g integer not null,
  cost_paise bigint,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index on raw_lots (received_at desc);
