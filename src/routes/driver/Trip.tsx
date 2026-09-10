import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { RoleGate } from '../../components/RoleGate'
import { TripPlanning } from './TripPlanning'
import type { CurrentUser } from '../../hooks/useSession'

interface StopRow {
  id: string
  seq: number
  status: string
  dispatched_qty: number | null
  orders: { order_no: number; customers: { shop_name: string; address: string | null } }
}

// SPEC.md Section 10.4: today's stop list in sequence.
export function Trip({ user }: { user: CurrentUser }) {
  const { data: stops, isLoading } = useQuery({
    queryKey: ['my-trip-stops', user.profileId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10)
      const { data: trip } = await supabase
        .from('trips')
        .select('id')
        .eq('driver_id', user.profileId)
        .eq('trip_date', today)
        .in('status', ['planned', 'out'])
        .maybeSingle()
      if (!trip) return []
      const { data, error } = await supabase
        .from('trip_stops')
        .select('id, seq, status, dispatched_qty, orders(order_no, customers(shop_name, address))')
        .eq('trip_id', trip.id)
        .order('seq')
      if (error) throw error
      return data as unknown as StopRow[]
    },
    enabled: user.roles.includes('driver'),
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Today's trip</h1>

      {user.roles.includes('driver') && (
        <>
          {isLoading && <p className="text-slate-400">Loading…</p>}
          {stops?.length === 0 && <p className="text-slate-400">No trip dispatched to you yet today.</p>}
          <div className="space-y-2">
            {stops?.map((s) => (
              <Link
                key={s.id}
                to={`/trip/stop/${s.id}`}
                className="block rounded-lg bg-slate-800 p-3"
              >
                <p className="font-medium">
                  {s.seq}. {s.orders.customers.shop_name}
                </p>
                <p className="text-sm text-slate-400">
                  Order #{s.orders.order_no} · {s.status}
                  {s.dispatched_qty !== null ? ` · ${s.dispatched_qty} units` : ''}
                </p>
              </Link>
            ))}
          </div>
        </>
      )}

      <RoleGate roles={user.roles} allow={['owner', 'supervisor']}>
        <TripPlanning />
      </RoleGate>
    </div>
  )
}
