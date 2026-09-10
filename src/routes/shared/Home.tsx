import { Link } from 'react-router-dom'
import type { CurrentUser } from '../../hooks/useSession'
import { HOME_ROUTE_BY_ROLE } from '../../lib/roles'
import { OutboxBadge } from '../../components/OutboxBadge'

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
        {actions.map((a) => (
          <Link
            key={a.path}
            to={a.path}
            className="h-24 rounded-xl bg-blue-600 flex items-center justify-center text-xl font-semibold"
          >
            {a.label}
          </Link>
        ))}
        <Link
          to="/calibration"
          className="h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
        >
          Daily scale check
        </Link>
      </div>
    </div>
  )
}
