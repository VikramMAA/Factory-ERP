import type { ReactNode } from 'react'
import type { UserRole } from '../lib/roles'

// Hides UI the current user has no reason to see. This is a convenience only —
// the server enforces access via RLS regardless of what this component shows.
// See CLAUDE.md invariant 8.
export function RoleGate({
  roles,
  allow,
  children,
}: {
  roles: UserRole[]
  allow: UserRole[]
  children: ReactNode
}) {
  const canSee = allow.some((r) => roles.includes(r))
  if (!canSee) return null
  return <>{children}</>
}
