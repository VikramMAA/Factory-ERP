create table flags (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,              -- see Appendix A
  severity     flag_severity not null,
  entity_type  text not null,
  entity_id    uuid not null,
  title        text not null,              -- describes the measurement, never the motive
  detail       jsonb not null default '{}'::jsonb,
  status       flag_status not null default 'open',
  created_at   timestamptz not null default now(),
  assigned_to  uuid references profiles(id),
  resolved_by  uuid references profiles(id),
  resolved_at  timestamptz,
  resolution_note text
);
create index on flags (status, severity, created_at desc);
create unique index on flags (code, entity_type, entity_id) where status = 'open';

create table audit_log (
  id         bigserial primary key,
  table_name text not null,
  row_id     text not null,
  action     text not null,
  actor_id   uuid,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
create index on audit_log (table_name, row_id, at desc);
