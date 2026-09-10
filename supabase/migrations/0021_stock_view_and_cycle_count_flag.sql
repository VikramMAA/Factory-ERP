-- SPEC.md Section 6.6: stock is derived, never stored (CLAUDE.md invariant 4).
--
-- security_invoker = true: Postgres views run with definer rights (the
-- owner's permissions, bypassing RLS on tables they read) by default unless
-- told otherwise. Both inventory_moves and products already grant read to
-- all authenticated users via `using (true)`, so this doesn't currently
-- expose anything extra — but it's the wrong default to leave in place.
--
-- The explicit revoke/grant matters for a different reason: 0011's
-- "revoke all from anon" loop iterates pg_tables, which does not include
-- views, so a view inherits Supabase's platform-default anon grant unless
-- revoked directly. With security_invoker on, anon querying this would hit
-- RLS on the underlying tables and fail anyway — but that's a fragile thing
-- to rely on as the only defense.
create view v_stock
with (security_invoker = true)
as
select p.id as product_id, p.code, p.name, p.category,
       coalesce(sum(m.qty_delta), 0)      as qty_on_hand,
       coalesce(sum(m.weight_delta_g), 0) as weight_on_hand_g
from products p
left join inventory_moves m on m.product_id = p.id
where p.is_active
group by p.id, p.code, p.name, p.category;

revoke all on v_stock from anon, authenticated;
grant select on v_stock to authenticated;

-- SPEC.md Section 9.5's fn_daily_checks (Phase 4) raises CYCLE_COUNT_VARIANCE
-- once a day for yesterday's counts. Phase 2's acceptance criteria need this
-- to fire immediately on entry instead of waiting for a nightly cron that
-- doesn't exist yet. fn_raise_flag's own dedupe (a partial unique index on
-- open flags) makes it safe to also leave fn_daily_checks doing the same
-- check later, as a backstop, without ever double-flagging the same count.
create or replace function fn_check_cycle_count_variance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.variance_qty <> 0 then
    select code into v_code from products where id = new.product_id;
    perform fn_raise_flag(
      'CYCLE_COUNT_VARIANCE',
      (case when abs(new.variance_qty) > 20 then 'high' else 'medium' end)::flag_severity,
      'product', new.product_id,
      format('Physical count of %s differs from the ledger by %s units', v_code, new.variance_qty),
      jsonb_build_object('variance_qty', new.variance_qty, 'cycle_count_id', new.id));
  end if;
  return null;
end $$;

create trigger trg_cycle_count_variance after insert on cycle_counts
  for each row execute function fn_check_cycle_count_variance();
revoke all on function fn_check_cycle_count_variance() from public, anon, authenticated;
