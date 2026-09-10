import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'

// Always visible. Operators must be able to see their work is not lost.
// See SPEC.md Section 10.3.
export function OutboxBadge() {
  const pending = useLiveQuery(
    () => db.outbox.where('status').anyOf('pending', 'uploading', 'uploaded', 'failed').count(),
    [],
    0
  )
  const [oldestAgeMs, setOldestAgeMs] = useState(0)

  useEffect(() => {
    const id = setInterval(async () => {
      const oldest = await db.outbox
        .where('status')
        .anyOf('pending', 'uploading', 'uploaded')
        .first()
      setOldestAgeMs(oldest ? Date.now() - oldest.createdAt : 0)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const stale = oldestAgeMs > 2 * 60 * 60 * 1000

  if (pending === 0) return <span className="text-xs text-emerald-400">All synced</span>

  return (
    <span
      className={`text-xs font-medium rounded-full px-3 py-1 ${
        stale ? 'bg-red-900 text-red-200' : 'bg-amber-900 text-amber-200'
      }`}
    >
      {pending} pending{stale ? ' — stuck over 2h' : ''}
    </span>
  )
}
