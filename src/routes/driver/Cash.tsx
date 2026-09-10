import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { RoleGate } from '../../components/RoleGate'
import { formatRupees } from '../../lib/units'
import type { CurrentUser } from '../../hooks/useSession'

interface Payment {
  id: string
  amount_paise: number
  collected_at: string
  profiles: { full_name: string }
}

// SPEC.md Section 10.4: my undeposited cash, hand-over confirmation. Only a
// supervisor can mark cash deposited (p_pay_deposit) — the driver hands cash
// over physically, and the supervisor confirms receipt in the app, which is
// the point of the control.
export function Cash({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient()
  const isSupervisor = user.roles.includes('owner') || user.roles.includes('supervisor')

  const { data: myPayments } = useQuery({
    queryKey: ['my-undeposited-cash', user.profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount_paise, collected_at')
        .eq('collected_by', user.profileId)
        .eq('mode', 'cash')
        .is('deposited_at', null)
        .order('collected_at')
      if (error) throw error
      return data as Omit<Payment, 'profiles'>[]
    },
    enabled: user.roles.includes('driver'),
  })

  const { data: allPayments } = useQuery({
    queryKey: ['all-undeposited-cash'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount_paise, collected_at, profiles(full_name)')
        .eq('mode', 'cash')
        .is('deposited_at', null)
        .order('collected_at')
      if (error) throw error
      return data as unknown as Payment[]
    },
    enabled: isSupervisor,
  })

  const markDeposited = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase
        .from('payments')
        .update({ deposited_at: new Date().toISOString() })
        .eq('id', paymentId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-undeposited-cash'] })
      queryClient.invalidateQueries({ queryKey: ['my-undeposited-cash'] })
    },
  })

  const myTotal = myPayments?.reduce((sum, p) => sum + p.amount_paise, 0) ?? 0

  return (
    <div className="p-4 space-y-6">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Cash</h1>

      {user.roles.includes('driver') && (
        <div className="space-y-2">
          <p className="text-sm text-slate-400">My undeposited cash</p>
          <p className="text-2xl font-bold">{formatRupees(myTotal)}</p>
          {myPayments?.map((p) => (
            <div key={p.id} className="rounded-lg bg-slate-800 p-3 flex items-center justify-between">
              <p className="text-sm text-slate-400">{new Date(p.collected_at).toLocaleString()}</p>
              <p className="font-medium">{formatRupees(p.amount_paise)}</p>
            </div>
          ))}
          {myPayments?.length === 0 && <p className="text-slate-500 text-sm">Nothing outstanding.</p>}
        </div>
      )}

      <RoleGate roles={user.roles} allow={['owner', 'supervisor']}>
        <div className="space-y-2 border-t border-slate-800 pt-4">
          <p className="text-sm text-slate-400">Awaiting hand-over from all drivers</p>
          {allPayments?.map((p) => (
            <div key={p.id} className="rounded-lg bg-slate-800 p-3 flex items-center justify-between">
              <div>
                <p className="font-medium">{p.profiles.full_name}</p>
                <p className="text-sm text-slate-400">{new Date(p.collected_at).toLocaleString()}</p>
              </div>
              <div className="text-right space-y-1">
                <p className="font-medium">{formatRupees(p.amount_paise)}</p>
                <button
                  className="h-touch px-3 rounded-lg bg-emerald-600 text-sm"
                  onClick={() => markDeposited.mutate(p.id)}
                  disabled={markDeposited.isPending}
                >
                  Mark deposited
                </button>
              </div>
            </div>
          ))}
          {allPayments?.length === 0 && <p className="text-slate-500 text-sm">Nothing outstanding.</p>}
        </div>
      </RoleGate>
    </div>
  )
}
