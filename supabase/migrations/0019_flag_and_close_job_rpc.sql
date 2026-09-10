-- SPEC.md Sections 8.1, 8.2 and 9.1-9.3. Phase 1 needs close_job, and
-- close_job calls fn_check_job_flags directly (Section 8.2's last line), so
-- the core flagging functions have to exist even though the /flags review
-- screen itself is Phase 4. Deferred to Phase 4: the operator scorecard
-- (needs 30 days of real data to mean anything) and the daily housekeeping
-- cron job.

create or replace function fn_raise_flag(
  p_code text, p_severity flag_severity, p_entity_type text,
  p_entity_id uuid, p_title text, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into flags(code, severity, entity_type, entity_id, title, detail)
  values (p_code, p_severity, p_entity_type, p_entity_id, p_title, p_detail)
  on conflict do nothing;
end $$;
revoke all on function fn_raise_flag(text, flag_severity, text, uuid, text, jsonb) from public, anon, authenticated;

-- Median and median absolute deviation, not mean and standard deviation. One
-- bad job should not move the threshold that judges the next one.
create or replace function fn_yield_baseline(
  p_product_id uuid, p_machine_id uuid, p_exclude uuid
) returns table (n integer, med numeric, mad numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select yield_pct from production_jobs
    where product_id = p_product_id and machine_id = p_machine_id
      and status = 'closed' and yield_pct is not null
      and (p_exclude is null or id <> p_exclude)
    order by closed_at desc limit 20
  ),
  m as (
    select percentile_cont(0.5) within group (order by yield_pct::double precision)::numeric as med
    from base
  )
  select (select count(*)::integer from base),
         (select med from m),
         (select percentile_cont(0.5) within group
                 (order by abs(yield_pct - (select med from m))::double precision)::numeric
          from base);
$$;
revoke all on function fn_yield_baseline(uuid, uuid, uuid) from public, anon;
grant execute on function fn_yield_baseline(uuid, uuid, uuid) to authenticated;

create or replace function fn_check_job_flags(p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j production_jobs; p products; b record;
  unit_g numeric; lo numeric; hi numeric; thresh numeric; loss_g numeric;
begin
  select * into j from production_jobs where id = p_job_id;
  select * into p from products where id = j.product_id;

  ---------------------------------------------------------------- Rule 1
  if j.output_units > 0 then
    unit_g := j.output_net_g::numeric / j.output_units;
    lo := p.target_net_g * (1 - p.tolerance_pct / 100);
    hi := p.target_net_g * (1 + p.tolerance_pct / 100);
    if unit_g < lo or unit_g > hi then
      perform fn_raise_flag('UNIT_WEIGHT_OUT_OF_SPEC',
        (case when unit_g < lo * 0.95 then 'high' else 'medium' end)::flag_severity,
        'production_job', p_job_id,
        format('Average unit weight %s g against a spec of %s g plus or minus %s%%',
               round(unit_g, 1), p.target_net_g, p.tolerance_pct),
        jsonb_build_object('unit_g', round(unit_g, 2), 'lo', round(lo, 2), 'hi', round(hi, 2)));
    end if;
  end if;

  ---------------------------------------------------------------- Rule 2
  select * into b from fn_yield_baseline(j.product_id, j.machine_id, p_job_id);
  if b.n >= 10 and b.med is not null then
    thresh := greatest(coalesce(b.mad, 0) * 1.4826 * 3, 0.75);
    if j.yield_pct < b.med - thresh then
      loss_g := round(j.input_g * (b.med - j.yield_pct) / 100);
      perform fn_raise_flag('YIELD_BELOW_BASELINE',
        (case when j.yield_pct < b.med - thresh * 2 then 'high' else 'medium' end)::flag_severity,
        'production_job', p_job_id,
        format('Yield %s%% against a baseline of %s%% over the last %s jobs. Difference is about %s g.',
               round(j.yield_pct, 2), round(b.med, 2), b.n, loss_g),
        jsonb_build_object('yield_pct', j.yield_pct, 'baseline_pct', b.med,
                           'mad', b.mad, 'n', b.n, 'delta_g', loss_g));
    end if;
  end if;

  ---------------------------------------------------------------- Rule 3
  if j.unaccounted_pct is not null and j.unaccounted_pct > 2.0 then
    perform fn_raise_flag('UNACCOUNTED_LOSS',
      (case when j.unaccounted_pct > 5 then 'critical'
            when j.unaccounted_pct > 3 then 'high' else 'medium' end)::flag_severity,
      'production_job', p_job_id,
      format('%s%% of input is neither output nor declared waste (%s g)',
             round(j.unaccounted_pct, 2), round(j.input_g * j.unaccounted_pct / 100)),
      jsonb_build_object('unaccounted_pct', j.unaccounted_pct, 'input_g', j.input_g));
  end if;

  ---------------------------------------------------------------- Rule 4
  if j.waste_pct is not null then
    if j.waste_pct > greatest(
         2 * coalesce((select percentile_cont(0.5) within group (order by waste_pct::double precision)
                       from production_jobs
                       where product_id = j.product_id and status = 'closed'
                         and id <> p_job_id and waste_pct is not null), 1.0), 3.0) then
      perform fn_raise_flag('WASTE_INFLATED', 'medium', 'production_job', p_job_id,
        format('Declared waste %s%% is well above the norm for this product', round(j.waste_pct, 2)),
        jsonb_build_object('waste_pct', j.waste_pct));
    end if;
  end if;
end $$;
revoke all on function fn_check_job_flags(uuid) from public, anon, authenticated;

-- Evidence integrity: fires on every weighment insert, not just production
-- ones, which is why it lives here rather than gated behind Phase 4.
create or replace function fn_check_weighment_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
declare skew numeric;
begin
  if exists (select 1 from weighments
             where photo_sha256 = new.photo_sha256 and id <> new.id) then
    perform fn_raise_flag('DUPLICATE_PHOTO', 'critical', 'weighment', new.id,
      'This photo has already been submitted for another weighment',
      jsonb_build_object('sha256', new.photo_sha256,
        'first_seen', (select min(server_ts) from weighments
                       where photo_sha256 = new.photo_sha256)));
  end if;

  skew := abs(extract(epoch from (new.server_ts - new.device_ts)));
  if skew > 300 then
    perform fn_raise_flag('CLOCK_SKEW',
      (case when skew > 86400 then 'high' else 'low' end)::flag_severity,
      'weighment', new.id,
      format('Device clock differs from server by %s minutes', round(skew / 60)),
      jsonb_build_object('skew_s', round(skew)));
  end if;
  return null;
end $$;

create trigger trg_weighment_integrity after insert on weighments
  for each row execute function fn_check_weighment_integrity();

-- close_job: the single most important function in the system. Everything
-- downstream reads what it writes.
create or replace function close_job(p_job_id uuid)
returns production_jobs
language plpgsql security definer set search_path = public as $$
declare
  j production_jobs;
  v_input_g integer; v_units integer; v_net_g integer; v_waste_g integer;
begin
  select * into j from production_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  if j.status <> 'open' then
    raise exception 'Job % is already %', j.job_no, j.status using errcode = 'check_violation';
  end if;
  if not (j.operator_id = auth.uid() or is_supervisor_up()) then
    raise exception 'Not permitted to close job %', j.job_no using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(weight_g), 0) into v_input_g from job_inputs where job_id = p_job_id;
  select coalesce(sum(unit_count), 0), coalesce(sum(net_g), 0)
    into v_units, v_net_g from job_outputs where job_id = p_job_id;
  select coalesce(sum(weight_g), 0) into v_waste_g from job_waste where job_id = p_job_id;

  if v_input_g = 0 then
    raise exception 'Job % has no input weighment', j.job_no using errcode = 'check_violation';
  end if;
  if v_units = 0 then
    raise exception 'Job % has no output weighment', j.job_no using errcode = 'check_violation';
  end if;

  update production_jobs set
    status = 'closed', closed_at = now(), closed_by = auth.uid(),
    input_g = v_input_g, output_units = v_units,
    output_net_g = v_net_g, waste_g = v_waste_g
  where id = p_job_id
  returning * into j;

  update raw_lots rl
  set remaining_g = greatest(rl.remaining_g - ji.used_g, 0)
  from (select raw_lot_id, sum(weight_g) as used_g
        from job_inputs where job_id = p_job_id group by raw_lot_id) ji
  where rl.id = ji.raw_lot_id;

  insert into inventory_moves(product_id, qty_delta, weight_delta_g, reason,
                              ref_type, ref_id, actor_id)
  values (j.product_id, v_units, v_net_g, 'production',
          'production_job', p_job_id, coalesce(auth.uid(), j.operator_id));

  perform fn_check_job_flags(p_job_id);
  return j;
end $$;

revoke all on function close_job(uuid) from public, anon;
grant execute on function close_job(uuid) to authenticated;
