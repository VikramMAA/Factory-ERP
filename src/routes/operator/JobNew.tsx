import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { WeighmentCapture } from '../../components/WeighmentCapture'
import { BackLink } from '../../components/BackLink'
import type { CurrentUser } from '../../hooks/useSession'

interface Machine {
  id: string
  code: string
  name: string
}
interface Product {
  id: string
  code: string
  name: string
}
interface RawLot {
  id: string
  lot_code: string
  remaining_g: number
}

const LAST_MACHINE_KEY = 'rewind.lastMachineId'
const LAST_PRODUCT_KEY = 'rewind.lastProductId'

// SPEC.md Section 10.4: machine, product, raw lot, input weight and photo.
// Target under 20 seconds end to end — machine/product default to whatever
// was used last on this device.
export function JobNew({ user }: { user: CurrentUser }) {
  const navigate = useNavigate()
  const [machineId, setMachineId] = useState(() => localStorage.getItem(LAST_MACHINE_KEY) ?? '')
  const [productId, setProductId] = useState(() => localStorage.getItem(LAST_PRODUCT_KEY) ?? '')
  const [rawLotId, setRawLotId] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const { data: machines } = useQuery({
    queryKey: ['my-machines', user.profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('machine_operators')
        .select('machines!inner(id, code, name)')
        .eq('profile_id', user.profileId)
      if (error) throw error
      return (data ?? []).map((r) => r.machines as unknown as Machine)
    },
  })

  const { data: products } = useQuery({
    queryKey: ['products-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, code, name')
        .eq('is_active', true)
        .order('code')
      if (error) throw error
      return data as Product[]
    },
  })

  const { data: rawLots } = useQuery({
    queryKey: ['raw-lots-available'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('raw_lots')
        .select('id, lot_code, remaining_g')
        .gt('remaining_g', 0)
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as RawLot[]
    },
  })

  useEffect(() => {
    if (machineId) localStorage.setItem(LAST_MACHINE_KEY, machineId)
  }, [machineId])
  useEffect(() => {
    if (productId) localStorage.setItem(LAST_PRODUCT_KEY, productId)
  }, [productId])
  useEffect(() => {
    if (!machineId && machines?.length) setMachineId(machines[0].id)
  }, [machines, machineId])
  useEffect(() => {
    if (!productId && products?.length) setProductId(products[0].id)
  }, [products, productId])

  const startJob = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('production_jobs')
        .insert({ machine_id: machineId, operator_id: user.profileId, product_id: productId })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (id) => setJobId(id),
    onError: (e: Error) => setStartError(e.message),
  })

  if (machines && machines.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <BackLink to="/" label="Home" />
        <p className="text-slate-400">
          You're not assigned to any machine yet. Ask an owner to assign one under Admin → Machine
          assignments.
        </p>
      </div>
    )
  }

  if (jobId) {
    const product = products?.find((p) => p.id === productId)
    return (
      <div className="p-4 space-y-4">
        <BackLink to="/" label="Home" />
        <h1 className="text-xl font-semibold">Input weight</h1>
        <p className="text-slate-400 text-sm">Job started. Weigh the raw material going in.</p>
        <WeighmentCapture
          kind="job_input"
          contextLabel={`Job input · ${product?.code ?? ''}`}
          operatorName={user.fullName}
          jobId={jobId}
          payload={{ rawLotId }}
          onCaptured={() => navigate(`/job/${jobId}`)}
        />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Start a job</h1>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Machine</span>
        <select
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
        >
          {machines?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} — {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Product</span>
        <select
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          {products?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Raw lot</span>
        <select
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={rawLotId}
          onChange={(e) => setRawLotId(e.target.value)}
        >
          <option value="">Select a lot</option>
          {rawLots?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.lot_code} ({(l.remaining_g / 1000).toFixed(1)} kg left)
            </option>
          ))}
        </select>
      </label>

      {startError && <p className="text-red-400 text-sm">{startError}</p>}

      <button
        className="w-full h-touch rounded-lg bg-blue-600 text-lg font-semibold disabled:opacity-50"
        disabled={!machineId || !productId || !rawLotId || startJob.isPending}
        onClick={() => startJob.mutate()}
      >
        {startJob.isPending ? 'Starting…' : 'Start job'}
      </button>
    </div>
  )
}
