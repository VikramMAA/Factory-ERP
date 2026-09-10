import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'

interface OrderRow {
  id: string
  order_no: number
  customers: { shop_name: string }
  order_lines: { qty: number; products: { code: string } }[]
}

// SPEC.md Section 10.4: queue of confirmed orders.
export function Pack() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['pack-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_no, customers(shop_name), order_lines(qty, products(code))')
        .eq('status', 'confirmed')
        .order('taken_at')
      if (error) throw error
      return data as unknown as OrderRow[]
    },
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Pack orders</h1>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {orders?.length === 0 && <p className="text-slate-400">Nothing waiting to be packed.</p>}

      <div className="space-y-2">
        {orders?.map((o) => (
          <Link
            key={o.id}
            to={`/pack/${o.id}`}
            className="block rounded-lg bg-slate-800 p-3"
          >
            <p className="font-medium">
              #{o.order_no} · {o.customers.shop_name}
            </p>
            <p className="text-sm text-slate-400">
              {o.order_lines.map((l) => `${l.products.code} × ${l.qty}`).join(', ')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
