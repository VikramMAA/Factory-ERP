-- Critical gotcha: an RLS policy on `profiles` that reads `profiles` causes infinite
-- recursion. Every role check must go through a SECURITY DEFINER function, which
-- bypasses RLS on the tables it touches.

create or replace function has_role(p_role user_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur
    join profiles p on p.id = ur.profile_id
    where ur.profile_id = auth.uid() and ur.role = p_role and p.is_active
  );
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('owner');
$$;

-- Supervisor or above. Used for every "can see everything" check.
create or replace function is_supervisor_up() returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('owner') or has_role('supervisor');
$$;

create or replace function operates_machine(p_machine_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from machine_operators
    where machine_id = p_machine_id and profile_id = auth.uid()
  );
$$;

create or replace function drives_trip_for_order(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_stops ts
    join trips t on t.id = ts.trip_id
    where ts.order_id = p_order_id and t.driver_id = auth.uid()
      and t.trip_date >= current_date - 1
  );
$$;

revoke all on function has_role(user_role), is_owner(), is_supervisor_up(),
  operates_machine(uuid), drives_trip_for_order(uuid) from public, anon;
grant execute on function has_role(user_role), is_owner(), is_supervisor_up(),
  operates_machine(uuid), drives_trip_for_order(uuid) to authenticated;
