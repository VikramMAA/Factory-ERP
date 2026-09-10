import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'

interface Machine {
  id: string
  code: string
  name: string
}
interface Operator {
  id: string
  full_name: string
}

// An operator can only start a job on a machine they're assigned to (RLS:
// operates_machine(machine_id), SPEC.md Section 7.2). Without this screen
// that assignment could only be made directly in Supabase.
export function AdminMachineOperators() {
  const queryClient = useQueryClient()

  const { data: machines } = useQuery({
    queryKey: ['admin-machines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('machines').select('id, code, name').order('code')
      if (error) throw error
      return data as Machine[]
    },
  })

  const { data: operators } = useQuery({
    queryKey: ['admin-operators'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('profile_id, profiles!inner(id, full_name)')
        .eq('role', 'operator')
      if (error) throw error
      return (data ?? []).map((r) => r.profiles as unknown as Operator)
    },
  })

  const { data: assignments } = useQuery({
    queryKey: ['admin-machine-operators'],
    queryFn: async () => {
      const { data, error } = await supabase.from('machine_operators').select('machine_id, profile_id')
      if (error) throw error
      return data as { machine_id: string; profile_id: string }[]
    },
  })

  const toggle = useMutation({
    mutationFn: async ({
      machineId,
      profileId,
      assigned,
    }: {
      machineId: string
      profileId: string
      assigned: boolean
    }) => {
      if (assigned) {
        const { error } = await supabase
          .from('machine_operators')
          .delete()
          .eq('machine_id', machineId)
          .eq('profile_id', profileId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('machine_operators')
          .insert({ machine_id: machineId, profile_id: profileId })
        if (error) throw error
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-machine-operators'] }),
  })

  function isAssigned(machineId: string, profileId: string) {
    return (assignments ?? []).some((a) => a.machine_id === machineId && a.profile_id === profileId)
  }

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/admin" label="Admin" />
      <h1 className="text-xl font-semibold">Machine assignments</h1>
      <p className="text-slate-400 text-sm">
        An operator can only start a job on a machine they're assigned to here.
      </p>

      {(!operators || operators.length === 0) && (
        <p className="text-slate-400">No one has the operator role yet. Add them under Users first.</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-2 pr-4">Operator</th>
              {machines?.map((m) => (
                <th key={m.id} className="py-2 px-2 text-center">
                  {m.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operators?.map((op) => (
              <tr key={op.id} className="border-t border-slate-800">
                <td className="py-2 pr-4">{op.full_name}</td>
                {machines?.map((m) => {
                  const assigned = isAssigned(m.id, op.id)
                  return (
                    <td key={m.id} className="py-2 px-2 text-center">
                      <button
                        className={`h-touch w-touch rounded-lg text-sm ${
                          assigned ? 'bg-blue-600' : 'bg-slate-800'
                        }`}
                        onClick={() =>
                          toggle.mutate({ machineId: m.id, profileId: op.id, assigned })
                        }
                        disabled={toggle.isPending}
                      >
                        {assigned ? '✓' : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toggle.isError && <p className="text-red-400 text-sm">{(toggle.error as Error).message}</p>}
    </div>
  )
}
