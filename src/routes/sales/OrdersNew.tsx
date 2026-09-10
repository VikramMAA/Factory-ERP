import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { isSupervisorUp } from '../../lib/roles'
import { rupeesToPaise } from '../../lib/units'
import type { CurrentUser } from '../../hooks/useSession'

interface Customer {
  id: string
  shop_name: string
}
interface Product {
  id: string
  code: string
  name: string
}
interface DraftLine {
  productId: string
  qty: number
  unitPriceRupees: string
}

// SPEC.md Section 10.4: customer, lines, price (floor enforced server-side —
// CLAUDE.md invariant 8, never re-implement that check client-side, only
// react to what the database actually decides).
export function OrdersNew({ user }: { user: CurrentUser }) {
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', qty: 1, unitPriceRupees: '' }])
  const [error, setError] = useState<string | null>(null)
  const [needsApproval, setNeedsApproval] = useState<number[]>([])

  const { data: customers } = useQuery({
    queryKey: ['customers-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, shop_name')
        .eq('is_active', true)
        .order('shop_name')
      if (error) throw error
      return data as Customer[]
    },
  })

  const { data: products } = useQuery({
    queryKey: ['products-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, code, name')
        .eq('is_active', true)
        .order('code')
      if (error) throw error
      return data as Product[]
    },
  })

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { productId: '', qty: 1, unitPriceRupees: '' }])
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i))
  }

  const submit = useMutation({
    mutationFn: async () => {
      setNeedsApproval([])
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({ customer_id: customerId, taken_by: user.profileId, channel: 'phone' })
        .select('id')
        .single()
      if (orderErr) throw orderErr

      const failedLineIndexes: number[] = []
      for (const [i, line] of lines.entries()) {
        if (!line.productId || !line.unitPriceRupees) continue
        const basePayload = {
          order_id: order.id,
          product_id: line.productId,
          qty: line.qty,
          unit_price_paise: rupeesToPaise(Number(line.unitPriceRupees)),
        }
        const { error: lineErr } = await supabase.from('order_lines').insert(basePayload)
        if (!lineErr) continue

        // A price below the floor with no approver is rejected by the
        // database (verified directly in tests/sql/60_sales_delivery.sql).
        // A supervisor placing the order can self-approve on the spot;
        // anyone else has to leave the line out and get one to add it later.
        if (/below the floor/.test(lineErr.message) && isSupervisorUp(user.roles)) {
          const { error: retryErr } = await supabase
            .from('order_lines')
            .insert({ ...basePayload, approved_by: user.profileId })
          if (retryErr) throw retryErr
        } else if (/below the floor/.test(lineErr.message)) {
          failedLineIndexes.push(i)
        } else {
          throw lineErr
        }
      }
      return { orderId: order.id as string, failedLineIndexes }
    },
    onSuccess: ({ orderId, failedLineIndexes }) => {
      if (failedLineIndexes.length > 0) {
        setNeedsApproval(failedLineIndexes)
        setError(
          'Some lines are below the price floor and need a supervisor to approve them before they can be added.'
        )
        return
      }
      navigate('/orders')
      void orderId
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/orders" label="Orders" />
      <h1 className="text-xl font-semibold">New order</h1>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Customer</span>
        <select
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">Select a shop</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shop_name}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-3">
        {lines.map((line, i) => (
          <div key={i} className={`rounded-lg p-3 space-y-2 ${needsApproval.includes(i) ? 'bg-amber-950' : 'bg-slate-800'}`}>
            <select
              className="w-full h-touch rounded-lg bg-slate-900 px-3"
              value={line.productId}
              onChange={(e) => updateLine(i, { productId: e.target.value })}
            >
              <option value="">Select a product</option>
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                placeholder="Qty"
                className="w-1/2 h-touch rounded-lg bg-slate-900 px-3"
                value={line.qty}
                onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Price per unit (₹)"
                className="w-1/2 h-touch rounded-lg bg-slate-900 px-3"
                value={line.unitPriceRupees}
                onChange={(e) => updateLine(i, { unitPriceRupees: e.target.value })}
              />
            </div>
            {needsApproval.includes(i) && (
              <p className="text-amber-400 text-xs">Below price floor — needs supervisor approval</p>
            )}
            {lines.length > 1 && (
              <button className="text-sm text-slate-400 underline" onClick={() => removeLine(i)}>
                Remove line
              </button>
            )}
          </div>
        ))}
        <button className="text-sm text-blue-400 underline" onClick={addLine}>
          + Add another product
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        className="w-full h-touch rounded-lg bg-blue-600 text-lg font-semibold disabled:opacity-50"
        disabled={!customerId || submit.isPending}
        onClick={() => submit.mutate()}
      >
        {submit.isPending ? 'Saving…' : 'Create order'}
      </button>
    </div>
  )
}
