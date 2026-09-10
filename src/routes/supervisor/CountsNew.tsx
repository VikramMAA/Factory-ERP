import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { NumberPad } from '../../components/NumberPad'
import type { CurrentUser } from '../../hooks/useSession'

interface Product {
  id: string
  code: string
  name: string
  target_net_g: number
}

// SPEC.md Section 10.4 (/counts/new) and Section 13 Phase 2 ("opening balance
// entry"). Two distinct actions on one screen:
//   - Record a physical count: compares what's actually there against the
//     ledger and flags a difference. It never changes the ledger itself —
//     CLAUDE.md invariant 11, a flag is a lead, not a correction applied
//     automatically. A supervisor investigates, then decides.
//   - Set opening balance: a direct, deliberate ledger entry for bootstrapping
//     stock the first time a product is counted, with no prior system figure
//     to compare against.
export function CountsNew({ user }: { user: CurrentUser }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'count' | 'opening'>('count')
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('0')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { data: products } = useQuery({
    queryKey: ['products-for-count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, code, name, target_net_g')
        .eq('is_active', true)
        .order('code')
      if (error) throw error
      return data as Product[]
    },
  })

  const recordCount = useMutation({
    mutationFn: async () => {
      const { data: stock, error: stockErr } = await supabase
        .from('v_stock')
        .select('qty_on_hand')
        .eq('product_id', productId)
        .maybeSingle()
      if (stockErr) throw stockErr
      const systemQty = stock?.qty_on_hand ?? 0

      const { error } = await supabase.from('cycle_counts').insert({
        product_id: productId,
        counted_qty: Number(qty),
        system_qty: systemQty,
        counted_by: user.profileId,
        note: note || null,
      })
      if (error) throw error
      return { systemQty, variance: Number(qty) - systemQty }
    },
    onSuccess: ({ variance }) => {
      setDone(
        variance === 0
          ? 'Count matches the ledger. No flag raised.'
          : `Count recorded. Difference of ${variance > 0 ? '+' : ''}${variance} units flagged for review.`
      )
      setQty('0')
      setNote('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const setOpening = useMutation({
    mutationFn: async () => {
      const product = products?.find((p) => p.id === productId)
      const { error } = await supabase.from('inventory_moves').insert({
        product_id: productId,
        qty_delta: Number(qty),
        weight_delta_g: Number(qty) * (product?.target_net_g ?? 0),
        reason: 'opening',
        actor_id: user.profileId,
        note: note || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setDone('Opening balance posted.')
      setQty('0')
      setNote('')
      navigate('/stock')
    },
    onError: (e: Error) => setError(e.message),
  })

  const busy = recordCount.isPending || setOpening.isPending

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/stock" label="Stock" />
      <h1 className="text-xl font-semibold">
        {mode === 'count' ? 'Record a physical count' : 'Set opening balance'}
      </h1>

      <div className="flex gap-2">
        <button
          className={`h-touch px-4 rounded-lg text-sm ${mode === 'count' ? 'bg-blue-600' : 'bg-slate-800'}`}
          onClick={() => setMode('count')}
        >
          Physical count
        </button>
        <button
          className={`h-touch px-4 rounded-lg text-sm ${mode === 'opening' ? 'bg-blue-600' : 'bg-slate-800'}`}
          onClick={() => setMode('opening')}
        >
          Opening balance
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Product</span>
        <select
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          <option value="">Select a product</option>
          {products?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">
          {mode === 'count' ? 'Counted units' : 'Opening units'}
        </span>
        <NumberPad value={qty} onChange={setQty} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Note (optional)</span>
        <input
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {done && <p className="text-emerald-400 text-sm">{done}</p>}

      <button
        className="w-full h-touch rounded-lg bg-blue-600 text-lg font-semibold disabled:opacity-50"
        disabled={!productId || busy}
        onClick={() => (mode === 'count' ? recordCount.mutate() : setOpening.mutate())}
      >
        {busy ? 'Saving…' : mode === 'count' ? 'Submit count' : 'Post opening balance'}
      </button>
    </div>
  )
}
