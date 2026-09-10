import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { isSupervisorUp } from '../../lib/roles'
import { formatRupees } from '../../lib/units'
import type { CurrentUser } from '../../hooks/useSession'

interface OrderRow {
  id: string
  order_no: number
  status: string
  taken_at: string
  customers: { shop_name: string }
  order_lines: { line_total_paise: number }[]
}

// SPEC.md Section 10.4: recent orders and status. A supervisor also confirms
// draft orders here — the RLS policy for a plain order_taker requires the
// order to STAY draft after their own update (no explicit WITH CHECK, so
// Postgres reuses the whole USING expression), so only a supervisor's
// unrestricted branch can actually move status forward.
export function OrdersList({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient()
  const canConfirm = isSupervisorUp(user.roles)

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_no, status, taken_at, customers(shop_name), order_lines(line_total_paise)')
        .order('taken_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as unknown as OrderRow[]
    },
  })

  const confirm = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.from('orders').update({ status: 'confirmed' }).eq('id', orderId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <Link to="/orders/new" className="h-touch px-4 rounded-lg bg-blue-600 flex items-center text-sm font-medium">
          New order
        </Link>
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}

      <div className="space-y-2">
        {orders?.map((o) => {
          const total = o.order_lines.reduce((sum, l) => sum + l.line_total_paise, 0)
          return (
            <div key={o.id} className="rounded-lg bg-slate-800 p-3 flex items-center justify-between">
              <div>
                <p className="font-medium">
                  #{o.order_no} · {o.customers.shop_name}
                </p>
                <p className="text-sm text-slate-400">
                  {o.status} · {formatRupees(total)}
                </p>
              </div>
              {canConfirm && o.status === 'draft' && (
                <button
                  className="h-touch px-3 rounded-lg bg-emerald-600 text-sm font-medium"
                  onClick={() => confirm.mutate(o.id)}
                  disabled={confirm.isPending}
                >
                  Confirm
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
