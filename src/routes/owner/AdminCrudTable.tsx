import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'

export interface CrudField {
  name: string
  label: string
  type?: 'text' | 'number' | 'checkbox'
}

// One generic screen for the master-data tables an owner administers directly
// (products, tube_types, packaging, machines, scales). Write access is gated
// server-side by `p_<table>_write using (is_owner())` — this component never
// decides who may write, it just calls the table and lets RLS answer.
export function AdminCrudTable({
  table,
  title,
  fields,
}: {
  table: string
  title: string
  fields: CrudField[]
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string | boolean>>({})

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ['admin', table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select('*').order('code')
      if (error) throw error
      return data as Record<string, unknown>[]
    },
  })

  const insert = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {}
      for (const f of fields) {
        if (f.type === 'number') payload[f.name] = Number(draft[f.name] ?? 0)
        else if (f.type === 'checkbox') payload[f.name] = Boolean(draft[f.name])
        else payload[f.name] = draft[f.name] ?? ''
      }
      const { error } = await supabase.from(table).insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      setDraft({})
      queryClient.invalidateQueries({ queryKey: ['admin', table] })
    },
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from(table).update({ is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', table] }),
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/admin" label="Admin" />
      <h1 className="text-xl font-semibold">{title}</h1>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {error && <p className="text-red-400">{(error as Error).message}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              {fields.map((f) => (
                <th key={f.name} className="py-2 pr-4">
                  {f.label}
                </th>
              ))}
              {'is_active' in (rows?.[0] ?? {}) && <th className="py-2 pr-4">Active</th>}
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => (
              <tr key={row.id as string} className="border-t border-slate-800">
                {fields.map((f) => (
                  <td key={f.name} className="py-2 pr-4">
                    {String(row[f.name] ?? '')}
                  </td>
                ))}
                {'is_active' in row && (
                  <td className="py-2 pr-4">
                    <button
                      className="h-touch px-3 rounded-lg bg-slate-800"
                      onClick={() =>
                        toggleActive.mutate({ id: row.id as string, is_active: !row.is_active })
                      }
                    >
                      {row.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-4">
        <p className="font-medium">Add new</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((f) =>
            f.type === 'checkbox' ? (
              <label key={f.name} className="flex items-center gap-2 h-touch">
                <input
                  type="checkbox"
                  checked={Boolean(draft[f.name])}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.checked }))}
                />
                {f.label}
              </label>
            ) : (
              <input
                key={f.name}
                placeholder={f.label}
                type={f.type === 'number' ? 'number' : 'text'}
                className="h-touch rounded-lg bg-slate-800 px-3"
                value={(draft[f.name] as string) ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
              />
            )
          )}
        </div>
        {insert.isError && (
          <p className="text-red-400 text-sm">{(insert.error as Error).message}</p>
        )}
        <button
          className="h-touch px-4 rounded-lg bg-blue-600 font-medium"
          onClick={() => insert.mutate()}
          disabled={insert.isPending}
        >
          {insert.isPending ? 'Saving…' : 'Add'}
        </button>
      </div>
    </div>
  )
}
