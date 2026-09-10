import { Link } from 'react-router-dom'

// The app installs as a PWA, and in standalone display mode there is no
// browser back button — every screen below home needs its own way back.
export function BackLink({ to = '/', label = 'Back' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="inline-flex items-center h-touch text-sm text-slate-400">
      ← {label}
    </Link>
  )
}
