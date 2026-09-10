import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'

interface VarianceRow {
  week: string
  product: string
  machine: string
  operator: string
  jobs: number
  input_kg: number
  avg_yield_pct: number
  avg_unaccounted_pct: number
  unaccounted_kg: number
}

// SPEC.md Section 11.2: the one report that justifies the whole system.
// Same product, same machine, operators side by side, in kilograms — that
// comparison is the whole point.
export function ReportsVariance() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['v-weekly-variance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_weekly_variance')
        .select('*')
        .order('week', { ascending: false })
        .order('product')
        .order('machine')
      if (error) throw error
      return data as VarianceRow[]
    },
  })

  const grouped = new Map<string, VarianceRow[]>()
  for (const r of rows ?? []) {
    const key = `${r.week}__${r.product}__${r.machine}`
    grouped.set(key, [...(grouped.get(key) ?? []), r])
  }

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/dashboard" label="Dashboard" />
      <h1 className="text-xl font-semibold">Weekly variance</h1>
      <p className="text-slate-400 text-sm">
        Same product, same machine, operators side by side. A 3 percentage point gap on 500 kg of
        monthly input is roughly 15 kg — that's the number worth a conversation.
      </p>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {rows?.length === 0 && <p className="text-slate-400">No closed jobs in the last 13 weeks.</p>}

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([key, group]) => (
          <div key={key} className="rounded-lg bg-slate-800 p-3 space-y-2">
            <p className="font-medium">
              {new Date(group[0].week).toLocaleDateString()} · {group[0].product} · {group[0].machine}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="pr-3">Operator</th>
                    <th className="pr-3">Jobs</th>
                    <th className="pr-3">Input (kg)</th>
                    <th className="pr-3">Yield %</th>
                    <th className="pr-3">Unaccounted %</th>
                    <th>Unaccounted (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((r, i) => (
                    <tr key={i} className="border-t border-slate-700">
                      <td className="pr-3 py-1">{r.operator}</td>
                      <td className="pr-3 py-1">{r.jobs}</td>
                      <td className="pr-3 py-1">{r.input_kg}</td>
                      <td className="pr-3 py-1">{r.avg_yield_pct}</td>
                      <td className="pr-3 py-1">{r.avg_unaccounted_pct}</td>
                      <td className="py-1">{r.unaccounted_kg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
