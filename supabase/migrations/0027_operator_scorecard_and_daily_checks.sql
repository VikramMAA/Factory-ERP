-- SPEC.md Section 9.4-9.6 and 11.2.

create materialized view mv_operator_yield_30d as
select
  j.operator_id, j.product_id, j.machine_id,
  count(*)::integer                 as jobs,
  sum(j.input_g)::bigint            as input_g,
  round(avg(j.yield_pct), 3)        as avg_yield_pct,
  round(avg(j.unaccounted_pct), 3)  as avg_unaccounted_pct
from production_jobs j
where j.status = 'closed' and j.closed_at >= now() - interval '30 days'
group by 1, 2, 3;

create unique index on mv_operator_yield_30d (operator_id, product_id, machine_id);

-- Materialized views cannot have RLS policies at all in Postgres, so any
-- grant to authenticated exposes every row to every signed-in user
-- regardless of role — an operator could query this directly via REST and
-- see every other operator's 30-day yield, which is exactly the comparison
-- OPERATOR_YIELD_GAP is meant to keep supervisor-only. It's only ever read
-- by fn_operator_scorecard_flags (SECURITY DEFINER) and refreshed by the
-- cron job below, both running as postgres — no grant needed at all.
revoke all on mv_operator_yield_30d from anon, authenticated;

create or replace function fn_operator_scorecard_flags() returns void
language plpgsql security definer set search_path = public as $$
declare r record; peer numeric; gap numeric; loss_g numeric;
begin
  for r in select * from mv_operator_yield_30d where jobs >= 20 loop
    select percentile_cont(0.5) within group (order by avg_yield_pct::double precision)::numeric
      into peer
    from mv_operator_yield_30d
    where product_id = r.product_id and machine_id = r.machine_id
      and operator_id <> r.operator_id and jobs >= 10;

    continue when peer is null;
    gap := peer - r.avg_yield_pct;

    if gap > 1.5 then
      loss_g := round(r.input_g * gap / 100);
      perform fn_raise_flag('OPERATOR_YIELD_GAP',
        (case when gap > 3 then 'high' else 'medium' end)::flag_severity,
        'profile', r.operator_id,
        format('Thirty-day yield %s%% against a peer median of %s%% on the same product and machine, across %s jobs. The gap represents about %s kg.',
               round(r.avg_yield_pct, 2), round(peer, 2), r.jobs, round(loss_g / 1000.0, 1)),
        jsonb_build_object('gap_pp', gap, 'est_loss_g', loss_g, 'jobs', r.jobs,
                           'product_id', r.product_id, 'machine_id', r.machine_id));
    end if;
  end loop;
end $$;
revoke all on function fn_operator_scorecard_flags() from public, anon, authenticated;

create or replace function fn_daily_checks() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not exists (select 1 from calibration_checks where checked_at >= current_date) then
    perform fn_raise_flag('CALIBRATION_MISSED', 'medium', 'scale',
      (select id from scales where is_active limit 1),
      'No scale calibration was recorded yesterday', '{}'::jsonb);
  end if;

  for r in select id, job_no from production_jobs
           where status = 'open' and started_at < now() - interval '24 hours' loop
    perform fn_raise_flag('JOB_LEFT_OPEN', 'low', 'production_job', r.id,
      format('Job %s has been open for more than 24 hours', r.job_no), '{}'::jsonb);
  end loop;

  for r in select collected_by, sum(amount_paise) amt from payments
           where deposited_at is null and mode = 'cash'
             and collected_at < now() - interval '48 hours'
           group by collected_by loop
    perform fn_raise_flag('CASH_NOT_DEPOSITED', 'high', 'profile', r.collected_by,
      format('%s in cash collected more than 48 hours ago is not yet deposited',
             to_char(r.amt / 100.0, 'FM999999990.00')),
      jsonb_build_object('amount_paise', r.amt));
  end loop;

  -- Cycle-count variance is already flagged immediately on entry (0021's
  -- trg_cycle_count_variance) rather than waiting for this daily pass — see
  -- that migration's comment. Kept out of fn_daily_checks entirely rather
  -- than duplicated here: fn_raise_flag's dedupe makes a duplicate harmless,
  -- but there's no reason to re-scan cycle_counts every night for something
  -- already caught the moment it happened.
end $$;
revoke all on function fn_daily_checks() from public, anon, authenticated;

-- SPEC.md Section 9.6. pg_cron runs in UTC; these times land in the early
-- Indian morning.
select cron.schedule('operator-scorecard', '15 1 * * *', $$
  refresh materialized view concurrently mv_operator_yield_30d;
  select fn_operator_scorecard_flags();
$$);

select cron.schedule('daily-checks', '30 1 * * *', $$ select fn_daily_checks(); $$);

-- SPEC.md Section 11.2. Same view-security treatment as v_stock (0021/0022):
-- security_invoker so it runs with the caller's own RLS, and an explicit
-- anon revoke since views aren't covered by 0011's table-only sweep.
create view v_weekly_variance
with (security_invoker = true)
as
select
  date_trunc('week', j.closed_at)          as week,
  pr.code                                   as product,
  m.code                                    as machine,
  p.full_name                               as operator,
  count(*)                                  as jobs,
  round(sum(j.input_g) / 1000.0, 2)         as input_kg,
  round(avg(j.yield_pct), 2)                as avg_yield_pct,
  round(avg(j.unaccounted_pct), 2)          as avg_unaccounted_pct,
  round(sum(j.input_g * j.unaccounted_pct / 100) / 1000.0, 2) as unaccounted_kg
from production_jobs j
join products pr on pr.id = j.product_id
join machines m  on m.id  = j.machine_id
join profiles p  on p.id  = j.operator_id
where j.status = 'closed' and j.closed_at >= now() - interval '13 weeks'
group by 1, 2, 3, 4;

revoke all on v_weekly_variance from anon, authenticated;
grant select on v_weekly_variance to authenticated;
