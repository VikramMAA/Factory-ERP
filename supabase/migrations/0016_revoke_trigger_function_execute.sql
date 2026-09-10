-- fn_guard_last_owner, like fn_audit before it, is a trigger function that
-- should only ever fire as a trigger, as postgres. Postgres will refuse to run
-- it outside trigger context anyway, but there's no reason to leave it
-- reachable at /rest/v1/rpc/fn_guard_last_owner.
revoke all on function fn_guard_last_owner() from public, anon, authenticated;
