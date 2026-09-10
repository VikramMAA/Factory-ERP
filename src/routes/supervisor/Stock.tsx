import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { formatKg } from '../../lib/units'

interface StockRow {
  product_id: string
  code: string
  name: string
  category: string
  qty_on_hand: number
  weight_on_hand_g: number
}

// SPEC.md Section 10.4: current stock from v_stock. Never a stored column
// (CLAUDE.md invariant 4) — this screen only ever reads the view.
export function Stock() {
  const { data: rows, isLoading, error } = useQuery({
    queryKey: ['v_stock'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock').select('*').order('code')
      if (error) throw error
      return data as StockRow[]
    },
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Stock</h1>
        <Link
          to="/counts/new"
          className="h-touch px-4 rounded-lg bg-blue-600 flex items-center text-sm font-medium"
        >
          Record a count
        </Link>
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {error && <p className="text-red-400">{(error as Error).message}</p>}

      <div className="space-y-2">
        {rows?.map((r) => (
          <div key={r.product_id} className="rounded-lg bg-slate-800 p-3 flex items-center justify-between">
            <div>
              <p className="font-medium">
                {r.code} — {r.name}
              </p>
              <p className="text-sm text-slate-400">{r.category.replace('_', ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">{r.qty_on_hand} units</p>
              <p className="text-sm text-slate-400">{formatKg(r.weight_on_hand_g)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
