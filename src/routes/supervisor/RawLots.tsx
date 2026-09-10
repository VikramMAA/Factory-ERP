import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { formatKg } from '../../lib/units'
import type { CurrentUser } from '../../hooks/useSession'

interface RawLot {
  id: string
  lot_code: string
  supplier: string | null
  material: string | null
  count_denier: string | null
  received_at: string
  gross_g: number
  tare_g: number
  net_g: number
  remaining_g: number
}

// Raw material intake. SPEC.md Section 7.2: "Operators must be able to pick a
// lot when starting a job. Only a supervisor books stock in" — so this is
// gated to supervisor/owner, matching p_lots_write exactly, rather than
// living under the owner-only admin section.
//
// remaining_g has no default in the schema and must be set explicitly; a lot
// starts with all of its net weight available, and close_job draws it down
// from there.
export function RawLots({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient()
  const [lotCode, setLotCode] = useState('')
  const [supplier, setSupplier] = useState('')
  const [material, setMaterial] = useState('')
  const [countDenier, setCountDenier] = useState('')
  const [grossKg, setGrossKg] = useState('')
  const [tareKg, setTareKg] = useState('0')
  const [error, setError] = useState<string | null>(null)

  const { data: lots, isLoading } = useQuery({
    queryKey: ['raw-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('raw_lots')
        .select('id, lot_code, supplier, material, count_denier, received_at, gross_g, tare_g, net_g, remaining_g')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as RawLot[]
    },
  })

  const addLot = useMutation({
    mutationFn: async () => {
      // Weights are entered in kg for a human but stored as integer grams —
      // CLAUDE.md invariant 1. units.ts owns the conversion.
      const grossG = Math.round(Number(grossKg) * 1000)
      const tareG = Math.round(Number(tareKg || '0') * 1000)
      if (!(grossG > 0)) throw new Error('Gross weight must be more than zero.')
      if (tareG > grossG) throw new Error('Tare cannot be more than the gross weight.')

      const { error } = await supabase.from('raw_lots').insert({
        lot_code: lotCode,
        supplier: supplier || null,
        material: material || null,
        count_denier: countDenier || null,
        gross_g: grossG,
        tare_g: tareG,
        remaining_g: grossG - tareG,
        created_by: user.profileId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setLotCode('')
      setSupplier('')
      setMaterial('')
      setCountDenier('')
      setGrossKg('')
      setTareKg('0')
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['raw-lots'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Raw material</h1>
        <ExportCsvButton filename="raw-lots.csv" rows={lots} />
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {lots?.length === 0 && (
        <p className="text-slate-400">
          No lots booked in yet. An operator can't start a job until at least one lot has
          material remaining.
        </p>
      )}

      <div className="space-y-2">
        {lots?.map((l) => (
          <div key={l.id} className="rounded-lg bg-slate-800 p-3 flex items-center justify-between">
            <div>
              <p className="font-medium">{l.lot_code}</p>
              <p className="text-sm text-slate-400">
                {[l.supplier, l.material, l.count_denier].filter(Boolean).join(' · ') || 'no details'}
              </p>
              <p className="text-xs text-slate-500">Received {l.received_at}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{formatKg(l.remaining_g)}</p>
              <p className="text-xs text-slate-400">of {formatKg(l.net_g)} left</p>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-4">
        <p className="font-medium">Book in a lot</p>
        <input
          placeholder="Lot code"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={lotCode}
          onChange={(e) => setLotCode(e.target.value)}
        />
        <input
          placeholder="Supplier (optional)"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
        <input
          placeholder="Material (optional)"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
        />
        <input
          placeholder="Count / denier (optional)"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={countDenier}
          onChange={(e) => setCountDenier(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            type="number"
            step="0.001"
            placeholder="Gross (kg)"
            className="w-1/2 h-touch rounded-lg bg-slate-800 px-3"
            value={grossKg}
            onChange={(e) => setGrossKg(e.target.value)}
          />
          <input
            type="number"
            step="0.001"
            placeholder="Tare (kg)"
            className="w-1/2 h-touch rounded-lg bg-slate-800 px-3"
            value={tareKg}
            onChange={(e) => setTareKg(e.target.value)}
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          className="w-full h-touch rounded-lg bg-blue-600 font-medium disabled:opacity-50"
          disabled={!lotCode || !grossKg || addLot.isPending}
          onClick={() => addLot.mutate()}
        >
          {addLot.isPending ? 'Saving…' : 'Book in'}
        </button>
      </div>
    </div>
  )
}
