import { Link } from 'react-router-dom'
import type { CurrentUser } from '../../hooks/useSession'
import { HOME_ROUTE_BY_ROLE } from '../../lib/roles'
import { OutboxBadge } from '../../components/OutboxBadge'
import { ChangePassword } from '../../components/ChangePassword'
import { RoleGate } from '../../components/RoleGate'
import { supabase } from '../../lib/supabase'

// Role-aware home: the largest button is the most common action for the roles
// this user actually holds. See SPEC.md Section 10.4.
export function Home({ user }: { user: CurrentUser }) {
  const actions = HOME_ROUTE_BY_ROLE.filter((a) => user.roles.includes(a.role))

  return (
    <div className="min-h-screen p-4 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">Signed in as</p>
          <p className="text-lg font-medium">{user.fullName}</p>
        </div>
        <OutboxBadge />
      </header>

      <div className="grid gap-4">
        {actions.length === 0 && (
          <p className="text-slate-400">
            No roles assigned yet. Ask an owner to assign one under Admin.
          </p>
        )}

        {actions.map((a) =>
          a.built ? (
            <Link
              key={a.path}
              to={a.path}
              className="h-24 rounded-xl bg-blue-600 flex items-center justify-center text-xl font-semibold"
            >
              {a.label}
            </Link>
          ) : (
            <div
              key={a.path}
              className="h-24 rounded-xl bg-slate-800 border border-slate-700 flex flex-col items-center justify-center gap-1"
            >
              <span className="text-xl font-semibold text-slate-500">{a.label}</span>
              <span className="text-xs text-slate-500">Not built yet — phase {a.phase}</span>
            </div>
          )
        )}

        <RoleGate roles={user.roles} allow={['operator']}>
          <Link
            to="/jobs"
            className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
          >
            My jobs today
          </Link>
        </RoleGate>

        <RoleGate roles={user.roles} allow={['owner', 'supervisor']}>
          <Link
            to="/stock"
            className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
          >
            Stock
          </Link>
        </RoleGate>

        <RoleGate roles={user.roles} allow={['order_taker', 'owner', 'supervisor']}>
          <Link
            to="/orders"
            className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
          >
            Orders
          </Link>
          <Link
            to="/customers"
            className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
          >
            Customers
          </Link>
        </RoleGate>

        <RoleGate roles={user.roles} allow={['driver', 'owner', 'supervisor']}>
          <Link
            to="/cash"
            className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
          >
            Cash
          </Link>
        </RoleGate>

        <RoleGate roles={user.roles} allow={['owner', 'supervisor']}>
          <Link
            to="/trip"
            className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
          >
            Trips &amp; dispatch
          </Link>
          <Link
            to="/pack"
            className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
          >
            Pack orders
          </Link>
        </RoleGate>

        <RoleGate roles={user.roles} allow={['owner']}>
          <Link
            to="/admin"
            className="h-touch rounded-lg bg-blue-600 flex items-center justify-center text-base font-medium"
          >
            Admin — people, products, machines
          </Link>
        </RoleGate>

        <Link
          to="/calibration"
          className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
        >
          Daily scale check
        </Link>
      </div>

      <div className="flex items-center justify-between pt-2">
        <ChangePassword />
        <button
          className="text-sm text-slate-400 underline"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
