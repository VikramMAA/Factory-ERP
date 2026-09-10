import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { WeighmentCapture } from '../../components/WeighmentCapture'
import { NumberPad } from '../../components/NumberPad'
import { BackLink } from '../../components/BackLink'
import type { CurrentUser } from '../../hooks/useSession'
import { formatKg } from '../../lib/units'

interface JobRow {
  id: string
  job_no: number
  status: 'open' | 'closed' | 'void'
  yield_pct: number | null
  waste_pct: number | null
  unaccounted_pct: number | null
  output_units: number | null
  products: { code: string; name: string; tube_type_id: string | null }
  tube_type_tare_g: number
}

// SPEC.md Section 10.4: add output (units, gross weight, photo), add waste,
// close. close_job's rollups are computed from whatever rows already exist
// server-side, so Close is disabled until this device has nothing left
// queued for this job — otherwise a still-syncing input or output would be
// silently missing from the yield calculation.
export function JobDetail({ user }: { user: CurrentUser }) {
  const { id: jobId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'output' | 'waste'>('idle')
  const [unitCount, setUnitCount] = useState('0')
  const [otherTareG, setOtherTareG] = useState('0')
  const [wasteReason, setWasteReason] = useState('')
  const [closeError, setCloseError] = useState<string | null>(null)

  const { data: job, isLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_jobs')
        .select(
          'id, job_no, status, yield_pct, waste_pct, unaccounted_pct, output_units, products(code, name, tube_type_id, tube_types(tare_g))'
        )
        .eq('id', jobId)
        .single()
      if (error) throw error
      const products = data.products as unknown as {
        code: string
        name: string
        tube_type_id: string | null
        tube_types: { tare_g: number } | null
      }
      return {
        ...data,
        products,
        tube_type_tare_g: products.tube_types?.tare_g ?? 0,
      } as JobRow
    },
    enabled: !!jobId,
  })

  const pendingCount = useLiveQuery(
    () => db.outbox.where('jobId').equals(jobId ?? '').and((i) => i.status !== 'done').count(),
    [jobId],
    0
  )

  const closeJob = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('close_job', { p_job_id: jobId })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] })
      navigate('/jobs')
    },
    onError: (e: Error) => setCloseError(e.message),
  })

  if (isLoading || !job) {
    return (
      <div className="p-4">
        <BackLink to="/" label="Home" />
        <p className="text-slate-400 mt-4">Loading…</p>
      </div>
    )
  }

  const tubeTareG = Number(unitCount) * job.tube_type_tare_g

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/jobs" label="My jobs" />
      <div>
        <h1 className="text-xl font-semibold">
          Job #{job.job_no} · {job.products.code}
        </h1>
        <p className="text-slate-400 text-sm">{job.status}</p>
      </div>

      {job.status === 'closed' && (
        <div className="rounded-lg bg-slate-800 p-4 space-y-1">
          <p>Units: {job.output_units}</p>
          <p>Yield: {job.yield_pct}%</p>
          <p>Waste: {job.waste_pct}%</p>
          <p>Unaccounted: {job.unaccounted_pct}%</p>
        </div>
      )}

      {job.status === 'open' && (
        <>
          {mode === 'idle' && (
            <div className="grid gap-3">
              <button
                className="h-touch rounded-lg bg-blue-600 font-medium"
                onClick={() => setMode('output')}
              >
                Add output
              </button>
              <button
                className="h-touch rounded-lg bg-slate-800 font-medium"
                onClick={() => setMode('waste')}
              >
                Add waste
              </button>
            </div>
          )}

          {mode === 'output' && (
            <div className="space-y-4">
              <button type="button" className="text-sm text-slate-400 underline" onClick={() => setMode("idle")}>← Cancel</button>
              <label className="block space-y-1">
                <span className="text-sm text-slate-400">Unit count</span>
                <NumberPad value={unitCount} onChange={setUnitCount} />
              </label>
              <p className="text-sm text-slate-400">
                Tube tare: {formatKg(tubeTareG)} ({job.tube_type_tare_g} g × {unitCount || 0} units)
              </p>
              <label className="block space-y-1">
                <span className="text-sm text-slate-400">Other tare (tray/crate), g</span>
                <input
                  type="number"
                  className="w-full h-touch rounded-lg bg-slate-800 px-3"
                  value={otherTareG}
                  onChange={(e) => setOtherTareG(e.target.value)}
                />
              </label>
              <p className="text-sm text-slate-400">Now weigh the output (gross, tubes included):</p>
              <WeighmentCapture
                kind="job_output"
                contextLabel={`Job #${job.job_no} output · ${job.products.code}`}
                operatorName={user.fullName}
                jobId={jobId}
                payload={{
                  unitCount: Number(unitCount),
                  tubeTareG,
                  otherTareG: Number(otherTareG),
                }}
                onCaptured={() => {
                  setMode('idle')
                  setUnitCount('0')
                  setOtherTareG('0')
                }}
              />
            </div>
          )}

          {mode === 'waste' && (
            <div className="space-y-4">
              <button type="button" className="text-sm text-slate-400 underline" onClick={() => setMode("idle")}>← Cancel</button>
              <label className="block space-y-1">
                <span className="text-sm text-slate-400">Reason (optional)</span>
                <input
                  className="w-full h-touch rounded-lg bg-slate-800 px-3"
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value)}
                />
              </label>
              <WeighmentCapture
                kind="job_waste"
                contextLabel={`Job #${job.job_no} waste · ${job.products.code}`}
                operatorName={user.fullName}
                jobId={jobId}
                payload={{ reason: wasteReason || undefined }}
                onCaptured={() => {
                  setMode('idle')
                  setWasteReason('')
                }}
              />
            </div>
          )}

          <div className="border-t border-slate-800 pt-4 space-y-2">
            <p className="text-sm text-slate-400">
              {pendingCount === 0
                ? 'Everything for this job is synced.'
                : `${pendingCount} item(s) for this job still syncing.`}
            </p>
            {closeError && <p className="text-red-400 text-sm">{closeError}</p>}
            <button
              className="w-full h-touch rounded-lg bg-emerald-600 font-semibold disabled:opacity-40"
              disabled={pendingCount !== 0 || closeJob.isPending}
              onClick={() => closeJob.mutate()}
            >
              {closeJob.isPending ? 'Closing…' : 'Close job'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
