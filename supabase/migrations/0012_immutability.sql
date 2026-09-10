create or replace function fn_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'Table % is append-only. Post a reversing or voiding entry instead of editing row %.',
    tg_table_name, coalesce(old.id::text, '?')
    using errcode = 'restrict_violation';
end $$;

create trigger trg_weighments_no_update before update on weighments
  for each row execute function fn_block_mutation();
create trigger trg_weighments_no_delete before delete on weighments
  for each row execute function fn_block_mutation();
create trigger trg_moves_no_update before update on inventory_moves
  for each row execute function fn_block_mutation();
create trigger trg_moves_no_delete before delete on inventory_moves
  for each row execute function fn_block_mutation();

-- Belt and braces. See the note below on why the trigger alone is not enough.
revoke update, delete on
  weighments, inventory_moves, job_inputs, job_outputs, job_waste,
  packing_events, calibration_checks, cycle_counts, weighment_voids, audit_log
  from authenticated;

-- Closed jobs freeze. Voiding is a status change performed by the RPC only.
create or replace function fn_block_closed_job_edit() returns trigger
language plpgsql as $$
begin
  if old.status = 'closed' and new.status = 'closed' then
    raise exception 'Job % is closed. Raise a correction job instead.', old.job_no
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger trg_jobs_freeze before update on production_jobs
  for each row execute function fn_block_closed_job_edit();

-- Never trust the client for time or identity.
create or replace function fn_force_server_fields() returns trigger
language plpgsql as $$
begin
  new.server_ts := now();
  if auth.uid() is not null then
    new.actor_id := auth.uid();
  end if;
  return new;
end $$;
create trigger trg_weighments_force before insert on weighments
  for each row execute function fn_force_server_fields();

-- Generic audit trail.
create or replace function fn_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  -- Note: a record cannot be cast to jsonb directly. to_jsonb() is required.
  if tg_op in ('UPDATE','DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_after  := to_jsonb(new); end if;

  insert into audit_log(table_name, row_id, action, actor_id, before, after)
  values (tg_table_name,
          coalesce(v_after ->> 'id', v_before ->> 'id', '?'),
          tg_op, auth.uid(), v_before, v_after);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['products','tube_types','packaging','raw_lots','production_jobs',
                           'orders','order_lines','customers','trip_stops','payments',
                           'user_roles','flags','cycle_counts'] loop
    execute format(
      'create trigger trg_%1$s_audit after insert or update or delete on %1$I
       for each row execute function fn_audit()', t);
  end loop;
end $$;
