// Role constants and UI guards. These are hints only, for hiding buttons.
// Every permission is enforced again server-side by RLS. Never rely on this
// module for security — see CLAUDE.md invariant 8 and SPEC.md Section 10.4.

export type UserRole =
  | 'owner'
  | 'supervisor'
  | 'operator'
  | 'packer'
  | 'driver'
  | 'order_taker'

export const ALL_ROLES: UserRole[] = [
  'owner',
  'supervisor',
  'operator',
  'packer',
  'driver',
  'order_taker',
]

export function hasRole(roles: UserRole[], role: UserRole): boolean {
  return roles.includes(role)
}

export function isSupervisorUp(roles: UserRole[]): boolean {
  return hasRole(roles, 'owner') || hasRole(roles, 'supervisor')
}

// The largest button on the home screen, keyed by the first matching role.
export const HOME_ROUTE_BY_ROLE: Array<{ role: UserRole; path: string; label: string }> = [
  { role: 'operator', path: '/job/new', label: 'Start a job' },
  { role: 'packer', path: '/pack', label: 'Pack orders' },
  { role: 'driver', path: '/trip', label: "Today's trip" },
  { role: 'order_taker', path: '/orders/new', label: 'New order' },
  { role: 'supervisor', path: '/flags', label: 'Review flags' },
  { role: 'owner', path: '/dashboard', label: 'Dashboard' },
]
