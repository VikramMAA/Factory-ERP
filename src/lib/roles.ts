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
// `phase` is the SPEC.md Section 13 phase that builds the screen; anything
// whose phase hasn't shipped renders as disabled rather than as a link, so a
// tap lands on an explanation instead of silently bouncing off the catch-all
// route back to home.
export const HOME_ROUTE_BY_ROLE: Array<{
  role: UserRole
  path: string
  label: string
  built: boolean
  phase: number
}> = [
  { role: 'operator', path: '/job/new', label: 'Start a job', built: true, phase: 1 },
  { role: 'packer', path: '/pack', label: 'Pack orders', built: false, phase: 3 },
  { role: 'driver', path: '/trip', label: "Today's trip", built: false, phase: 3 },
  { role: 'order_taker', path: '/orders/new', label: 'New order', built: false, phase: 3 },
  { role: 'supervisor', path: '/flags', label: 'Review flags', built: false, phase: 4 },
  { role: 'owner', path: '/dashboard', label: 'Dashboard', built: false, phase: 4 },
]
