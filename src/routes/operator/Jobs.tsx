import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import type { CurrentUser } from '../../hooks/useSession'

interface JobRow {
  id: string
  job_no: number
  status: 'open' | 'closed' | 'void'
  yield_pct: number | null
  started_at: string
  products: { code: string }
}

// SPEC.md Section 10.4: my jobs today, with yield shown after close.
export function Jobs({ user }: { user: CurrentUser }) {
  const { data: jobs, isLoading } = useQuery({
    queryKey: ['my-jobs', user.profileId],
    queryFn: async () => {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('production_jobs')
        .select('id, job_no, status, yield_pct, started_at, products(code)')
        .eq('operator_id', user.profileId)
        .gte('started_at', startOfDay.toISOString())
        .order('started_at', { ascending: false })
      if (error) throw error
      return data as unknown as JobRow[]
    },
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My jobs today</h1>
        <Link to="/job/new" className="h-touch px-4 rounded-lg bg-blue-600 flex items-center text-sm font-medium">
          New job
        </Link>
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {jobs?.length === 0 && <p className="text-slate-400">No jobs yet today.</p>}

      <div className="space-y-2">
        {jobs?.map((j) => (
          <Link
            key={j.id}
            to={`/job/${j.id}`}
            className="rounded-lg bg-slate-800 p-3 flex items-center justify-between"
          >
            <div>
              <p className="font-medium">
                Job #{j.job_no} · {j.products.code}
              </p>
              <p className="text-sm text-slate-400">{j.status}</p>
            </div>
            {j.status === 'closed' && j.yield_pct !== null && (
              <p className="text-lg font-semibold">{j.yield_pct}%</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
