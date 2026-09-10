import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { uploadWeighmentPhoto, deliveryProofPath } from '../../lib/storage'
import { prepareWeighmentPhoto } from '../../lib/image'
import { NumberPad } from '../../components/NumberPad'
import { BackLink } from '../../components/BackLink'
import { rupeesToPaise } from '../../lib/units'
import type { CurrentUser } from '../../hooks/useSession'

interface StopRow {
  id: string
  dispatched_qty: number | null
  orders: { order_no: number; customers: { shop_name: string } }
}

// SPEC.md Section 10.4: delivered qty, receiver name, proof photo, cash
// collected. Delivery proof isn't a weighment (no weight involved) and
// deliver_stop has no idempotency key, so — like starting a job — this
// requires connectivity rather than going through the offline outbox.
export function TripStop({ user }: { user: CurrentUser }) {
  const { id: stopId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [deliveredQty, setDeliveredQty] = useState('0')
  const [receiver, setReceiver] = useState('')
  const [cashRupees, setCashRupees] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: stop, isLoading } = useQuery({
    queryKey: ['trip-stop', stopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_stops')
        .select('id, dispatched_qty, orders(order_no, customers(shop_name))')
        .eq('id', stopId)
        .single()
      if (error) throw error
      return data as unknown as StopRow
    },
    enabled: !!stopId,
  })

  const submit = useMutation({
    mutationFn: async () => {
      if (!photoFile) throw new Error('Take a proof-of-delivery photo first.')
      const deviceTs = new Date()
      const { blob } = await prepareWeighmentPhoto(photoFile, {
        line1: `Delivery · Order #${stop?.orders.order_no ?? ''}`,
        line2: `${user.fullName} · ${deviceTs.toLocaleString()}`,
      })
      const path = deliveryProofPath(stopId!, deviceTs)
      await uploadWeighmentPhoto(path, blob)

      const { error } = await supabase.rpc('deliver_stop', {
        p_stop_id: stopId,
        p_delivered_qty: Number(deliveredQty),
        p_receiver: receiver,
        p_proof_path: path,
        p_cash_paise: cashRupees ? rupeesToPaise(Number(cashRupees)) : 0,
      })
      if (error) throw error
    },
    onSuccess: () => navigate('/trip'),
    onError: (e: Error) => setError(e.message),
  })

  if (isLoading || !stop) {
    return (
      <div className="p-4">
        <BackLink to="/trip" label="Today's trip" />
        <p className="text-slate-400 mt-4">Loading…</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/trip" label="Today's trip" />
      <h1 className="text-xl font-semibold">{stop.orders.customers.shop_name}</h1>
      <p className="text-slate-400 text-sm">
        Order #{stop.orders.order_no} · dispatched {stop.dispatched_qty} units
      </p>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Delivered units</span>
        <NumberPad value={deliveredQty} onChange={setDeliveredQty} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Receiver name</span>
        <input
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Cash collected (₹, optional)</span>
        <input
          type="number"
          step="0.01"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={cashRupees}
          onChange={(e) => setCashRupees(e.target.value)}
        />
      </label>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="w-full h-touch rounded-lg bg-slate-800 font-medium"
        onClick={() => fileInputRef.current?.click()}
      >
        {photoFile ? 'Photo captured ✓' : 'Take proof-of-delivery photo'}
      </button>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        className="w-full h-touch rounded-lg bg-blue-600 text-lg font-semibold disabled:opacity-50"
        disabled={!receiver || !photoFile || submit.isPending}
        onClick={() => submit.mutate()}
      >
        {submit.isPending ? 'Saving…' : 'Confirm delivery'}
      </button>
    </div>
  )
}
