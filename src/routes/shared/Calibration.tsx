import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { CurrentUser } from '../../hooks/useSession'
import { BackLink } from '../../components/BackLink'
import { WeighmentCapture } from '../../components/WeighmentCapture'

interface Scale {
  id: string
  code: string
  location: string | null
}
interface ReferenceWeight {
  id: string
  code: string
  nominal_g: number
}

// SPEC.md Section 9.2's gotcha note: "select exists(select 1 from
// calibration_checks where checked_at >= current_date and abs(deviation_g)
// <= 2)" — a scale that was checked but found drifting still counts as "not
// calibrated" for the purposes of this banner.
export function Calibration({ user }: { user: CurrentUser }) {
  const [scaleId, setScaleId] = useState('')
  const [referenceWeightId, setReferenceWeightId] = useState('')
  const [done, setDone] = useState(false)

  const { data: checkedToday, refetch } = useQuery({
    queryKey: ['calibration-today'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('calibration_checks')
        .select('id', { count: 'exact', head: true })
        .gte('checked_at', new Date().toISOString().slice(0, 10))
        .lte('deviation_g', 2)
        .gte('deviation_g', -2)
      if (error) throw error
      return (count ?? 0) > 0
    },
  })

  const { data: scales } = useQuery({
    queryKey: ['scales-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scales')
        .select('id, code, location')
        .eq('is_active', true)
        .order('code')
      if (error) throw error
      return data as Scale[]
    },
  })

  const { data: referenceWeights } = useQuery({
    queryKey: ['reference-weights'],
    queryFn: async () => {
      const { data, error } = await supabase.from('reference_weights').select('id, code, nominal_g')
      if (error) throw error
      return data as ReferenceWeight[]
    },
  })

  const nominalG = referenceWeights?.find((r) => r.id === referenceWeightId)?.nominal_g

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Daily scale check</h1>
      <p className="text-slate-400">
        Weigh the reference weight, photograph the display, and log it below. Takes about a
        minute. Signed in as {user.fullName}.
      </p>
      <p className={checkedToday ? 'text-emerald-400' : 'text-amber-400'}>
        {checkedToday === undefined
          ? 'Checking…'
          : checkedToday
            ? 'Already logged today'
            : 'Not yet logged today'}
      </p>

      {done ? (
        <p className="text-emerald-400">Saved. Syncing in the background.</p>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-sm text-slate-400">Scale</span>
            <select
              className="w-full h-touch rounded-lg bg-slate-800 px-3"
              value={scaleId}
              onChange={(e) => setScaleId(e.target.value)}
            >
              <option value="">Select a scale</option>
              {scales?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                  {s.location ? ` — ${s.location}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-slate-400">Reference weight</span>
            <select
              className="w-full h-touch rounded-lg bg-slate-800 px-3"
              value={referenceWeightId}
              onChange={(e) => setReferenceWeightId(e.target.value)}
            >
              <option value="">Select a reference weight</option>
              {referenceWeights?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} ({r.nominal_g} g)
                </option>
              ))}
            </select>
          </label>

          {scaleId && referenceWeightId && (
            <WeighmentCapture
              kind="calibration"
              contextLabel={`Calibration · ${scales?.find((s) => s.id === scaleId)?.code ?? ''}`}
              operatorName={user.fullName}
              scaleId={scaleId}
              payload={{ referenceWeightId, nominalG }}
              onCaptured={() => {
                setDone(true)
                void refetch()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
