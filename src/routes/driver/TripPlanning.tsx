import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface Driver {
  id: string
  full_name: string
}
interface PackedOrder {
  id: string
  order_no: number
  customers: { shop_name: string }
}
interface PlannedTrip {
  id: string
  trip_no: number
  status: string
  profiles: { full_name: string }
}

// Supervisor-only: assemble today's trips from packed orders, then dispatch.
// Not a named SPEC.md screen, but /trip's stop list has to come from
// somewhere — dispatch_trip (Section 8.3) expects trip_stops to already
// exist, and nothing else in the spec creates them.
export function TripPlanning() {
  const queryClient = useQueryClient()
  const [driverId, setDriverId] = useState('')
  const [selectedOrders, setSelectedOrders] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const { data: drivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('profile_id, profiles!inner(id, full_name)')
        .eq('role', 'driver')
      if (error) throw error
      return (data ?? []).map((r) => r.profiles as unknown as Driver)
    },
  })

  const { data: packedOrders } = useQuery({
    queryKey: ['packed-unassigned-orders'],
    queryFn: async () => {
      const { data: assigned } = await supabase.from('trip_stops').select('order_id')
      const assignedIds = (assigned ?? []).map((a) => a.order_id)
      let query = supabase
        .from('orders')
        .select('id, order_no, customers(shop_name)')
        .eq('status', 'packed')
      if (assignedIds.length > 0) query = query.not('id', 'in', `(${assignedIds.join(',')})`)
      const { data, error } = await query.order('taken_at')
      if (error) throw error
      return data as unknown as PackedOrder[]
    },
  })

  const { data: todaysTrips } = useQuery({
    queryKey: ['todays-trips'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('trips')
        .select('id, trip_no, status, profiles(full_name)')
        .eq('trip_date', today)
        .order('trip_no')
      if (error) throw error
      return data as unknown as PlannedTrip[]
    },
  })

  function toggleOrder(id: string) {
    setSelectedOrders((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  const createTrip = useMutation({
    mutationFn: async () => {
      const { data: trip, error: tripErr } = await supabase
        .from('trips')
        .insert({ driver_id: driverId })
        .select('id')
        .single()
      if (tripErr) throw tripErr

      const stops = selectedOrders.map((orderId, i) => ({
        trip_id: trip.id,
        order_id: orderId,
        seq: i + 1,
      }))
      const { error: stopsErr } = await supabase.from('trip_stops').insert(stops)
      if (stopsErr) throw stopsErr
    },
    onSuccess: () => {
      setDriverId('')
      setSelectedOrders([])
      queryClient.invalidateQueries({ queryKey: ['packed-unassigned-orders'] })
      queryClient.invalidateQueries({ queryKey: ['todays-trips'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const dispatch = useMutation({
    mutationFn: async (tripId: string) => {
      const { error } = await supabase.rpc('dispatch_trip', { p_trip_id: tripId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todays-trips'] }),
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-4 border-t border-slate-800 pt-4">
      <h2 className="text-lg font-semibold">Plan a trip</h2>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Driver</span>
        <select
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
        >
          <option value="">Select a driver</option>
          {drivers?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <p className="text-sm text-slate-400">Packed orders ready to go out</p>
        {packedOrders?.length === 0 && <p className="text-slate-500 text-sm">None waiting.</p>}
        {packedOrders?.map((o) => (
          <label key={o.id} className="flex items-center gap-2 h-touch">
            <input
              type="checkbox"
              checked={selectedOrders.includes(o.id)}
              onChange={() => toggleOrder(o.id)}
            />
            #{o.order_no} · {o.customers.shop_name}
          </label>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        className="w-full h-touch rounded-lg bg-blue-600 font-medium disabled:opacity-50"
        disabled={!driverId || selectedOrders.length === 0 || createTrip.isPending}
        onClick={() => createTrip.mutate()}
      >
        {createTrip.isPending ? 'Creating…' : 'Create trip'}
      </button>

      <div className="space-y-2">
        <p className="text-sm text-slate-400">Today's trips</p>
        {todaysTrips?.map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-800 p-3 flex items-center justify-between">
            <p>
              Trip #{t.trip_no} · {t.profiles.full_name} · {t.status}
            </p>
            {t.status === 'planned' && (
              <button
                className="h-touch px-3 rounded-lg bg-emerald-600 text-sm font-medium"
                onClick={() => dispatch.mutate(t.id)}
                disabled={dispatch.isPending}
              >
                Dispatch
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
