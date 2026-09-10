import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { WeighmentCapture } from '../../components/WeighmentCapture'
import { BackLink } from '../../components/BackLink'
import type { CurrentUser } from '../../hooks/useSession'

interface OrderLine {
  qty: number
  products: { code: string; name: string }
}
interface Packaging {
  id: string
  code: string
  name: string
}

// SPEC.md Section 10.4: pick lines, choose packaging, weigh, photo, mark
// packed. The weighment goes through WeighmentCapture like every other
// weight in the app; the order's transition to 'packed' happens once that
// syncs, via pack_order (see src/lib/outbox.ts).
export function PackDetail({ user }: { user: CurrentUser }) {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const [packagingId, setPackagingId] = useState('')
  const [unitCount, setUnitCount] = useState('')

  const { data: order, isLoading } = useQuery({
    queryKey: ['pack-order', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_no, status, customers(shop_name), order_lines(qty, products(code, name))')
        .eq('id', orderId)
        .single()
      if (error) throw error
      return data as unknown as {
        id: string
        order_no: number
        status: string
        customers: { shop_name: string }
        order_lines: OrderLine[]
      }
    },
    enabled: !!orderId,
  })

  const { data: packagingOptions } = useQuery({
    queryKey: ['packaging-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging')
        .select('id, code, name')
        .eq('is_active', true)
        .order('code')
      if (error) throw error
      return data as Packaging[]
    },
  })

  if (isLoading || !order) {
    return (
      <div className="p-4">
        <BackLink to="/pack" label="Pack orders" />
        <p className="text-slate-400 mt-4">Loading…</p>
      </div>
    )
  }

  const totalQty = order.order_lines.reduce((sum, l) => sum + l.qty, 0)

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/pack" label="Pack orders" />
      <div>
        <h1 className="text-xl font-semibold">
          #{order.order_no} · {order.customers.shop_name}
        </h1>
        <p className="text-slate-400 text-sm">{order.status}</p>
      </div>

      <div className="rounded-lg bg-slate-800 p-3 space-y-1">
        {order.order_lines.map((l, i) => (
          <p key={i}>
            {l.products.code} — {l.products.name} × {l.qty}
          </p>
        ))}
      </div>

      {order.status === 'confirmed' && (
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-slate-400">Packaging</span>
            <select
              className="w-full h-touch rounded-lg bg-slate-800 px-3"
              value={packagingId}
              onChange={(e) => setPackagingId(e.target.value)}
            >
              <option value="">Select packaging</option>
              {packagingOptions?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-slate-400">Unit count</span>
            <input
              type="number"
              min={1}
              placeholder={`${totalQty} ordered`}
              className="w-full h-touch rounded-lg bg-slate-800 px-3"
              value={unitCount}
              onChange={(e) => setUnitCount(e.target.value)}
            />
          </label>

          {packagingId && unitCount && (
            <WeighmentCapture
              kind="pack"
              contextLabel={`Order #${order.order_no} pack`}
              operatorName={user.fullName}
              payload={{ orderId: order.id, packagingId, unitCount: Number(unitCount) }}
              onCaptured={() => navigate('/pack')}
            />
          )}
        </div>
      )}
    </div>
  )
}
