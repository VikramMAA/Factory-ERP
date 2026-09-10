import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { formatKg, formatRupees } from '../../lib/units'

interface ClosedJob {
  input_g: number
  output_units: number
  output_net_g: number
  yield_pct: number | null
  unaccounted_pct: number | null
  closed_at: string
}

// SPEC.md Section 11.1: four numbers at the top, nothing else above the fold.
export function Dashboard() {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const { data: todayJobs } = useQuery({
    queryKey: ['dashboard-today-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_jobs')
        .select('input_g, output_units, output_net_g, yield_pct, unaccounted_pct, closed_at')
        .eq('status', 'closed')
        .gte('closed_at', startOfDay.toISOString())
      if (error) throw error
      return data as ClosedJob[]
    },
  })

  const { data: baselineJobs } = useQuery({
    queryKey: ['dashboard-30d-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_jobs')
        .select('yield_pct')
        .eq('status', 'closed')
        .gte('closed_at', thirtyDaysAgo.toISOString())
      if (error) throw error
      return data as { yield_pct: number | null }[]
    },
  })

  const { data: openFlagCounts } = useQuery({
    queryKey: ['dashboard-open-flags'],
    queryFn: async () => {
      const { data, error } = await supabase.from('flags').select('severity').eq('status', 'open')
      if (error) throw error
      const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 }
      for (const f of data ?? []) counts[f.severity] = (counts[f.severity] ?? 0) + 1
      return counts
    },
  })

  // SPEC.md Section 2 and Phase 5: Supabase Free's 1 GB storage ceiling is
  // the one that actually breaks (photo storage). Warn at 70%.
  const STORAGE_LIMIT_BYTES = 1024 ** 3
  const { data: storageBytes } = useQuery({
    queryKey: ['dashboard-storage-usage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_storage_usage_bytes')
      if (error) throw error
      return data as number
    },
  })

  const { data: cashByDriver } = useQuery({
    queryKey: ['dashboard-cash-by-driver'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('amount_paise, profiles(full_name)')
        .eq('mode', 'cash')
        .is('deposited_at', null)
      if (error) throw error
      const byDriver = new Map<string, number>()
      for (const p of data as unknown as { amount_paise: number; profiles: { full_name: string } }[]) {
        const name = p.profiles.full_name
        byDriver.set(name, (byDriver.get(name) ?? 0) + p.amount_paise)
      }
      return Array.from(byDriver.entries())
    },
  })

  const producedUnits = todayJobs?.reduce((s, j) => s + j.output_units, 0) ?? 0
  const producedNetG = todayJobs?.reduce((s, j) => s + j.output_net_g, 0) ?? 0

  const todayYields = (todayJobs ?? []).map((j) => j.yield_pct).filter((y): y is number => y !== null)
  const todayAvgYield = todayYields.length > 0 ? todayYields.reduce((a, b) => a + b, 0) / todayYields.length : null

  const baselineYields = (baselineJobs ?? [])
    .map((j) => j.yield_pct)
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b)
  const baselineMedian =
    baselineYields.length > 0 ? baselineYields[Math.floor(baselineYields.length / 2)] : null

  const unaccountedTodayG =
    todayJobs?.reduce((s, j) => s + (j.input_g * (j.unaccounted_pct ?? 0)) / 100, 0) ?? 0

  const totalOpenFlags = Object.values(openFlagCounts ?? {}).reduce((a, b) => a + b, 0)

  return (
    <div className="p-4 space-y-6">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3">
        <Tile label="Produced today" value={`${producedUnits} units`} sub={formatKg(producedNetG)} />
        <Tile
          label="Yield today vs 30-day"
          value={todayAvgYield !== null ? `${todayAvgYield.toFixed(1)}%` : '—'}
          sub={baselineMedian !== null ? `median ${baselineMedian.toFixed(1)}%` : 'no baseline yet'}
        />
        <Tile label="Unaccounted today" value={formatKg(unaccountedTodayG)} />
        <Link to="/flags" className="block">
          <Tile label="Open flags" value={String(totalOpenFlags)} sub={severitySummary(openFlagCounts)} />
        </Link>
      </div>

      {storageBytes !== undefined && (
        <div className="space-y-1">
          <p className="text-sm text-slate-400">
            Photo storage: {(storageBytes / 1024 / 1024).toFixed(0)} MB of 1024 MB
          </p>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full ${storageBytes / STORAGE_LIMIT_BYTES > 0.7 ? 'bg-amber-500' : 'bg-blue-600'}`}
              style={{ width: `${Math.min(100, (storageBytes / STORAGE_LIMIT_BYTES) * 100)}%` }}
            />
          </div>
          {storageBytes / STORAGE_LIMIT_BYTES > 0.7 && (
            <p className="text-amber-400 text-xs">
              Over 70% of the free storage tier. See SPEC.md Section 12.4 for the R2 migration path.
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm text-slate-400">Cash outstanding by driver</p>
        {cashByDriver?.length === 0 && <p className="text-slate-500 text-sm">Nothing outstanding.</p>}
        {cashByDriver?.map(([name, amount]) => (
          <div key={name} className="rounded-lg bg-slate-800 p-3 flex items-center justify-between">
            <p>{name}</p>
            <p className="font-medium">{formatRupees(amount)}</p>
          </div>
        ))}
      </div>

      <Link
        to="/reports/variance"
        className="block h-touch rounded-lg bg-slate-800 flex items-center justify-center text-base"
      >
        Weekly variance report
      </Link>
    </div>
  )
}

function severitySummary(counts?: Record<string, number>) {
  if (!counts) return ''
  return (['critical', 'high', 'medium', 'low'] as const)
    .filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(', ')
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-800 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  )
}
