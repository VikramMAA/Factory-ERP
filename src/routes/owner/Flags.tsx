import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'
import { getSignedPhotoUrl } from '../../lib/storage'
import type { CurrentUser } from '../../hooks/useSession'

interface Flag {
  id: string
  code: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  entity_type: string
  entity_id: string
  title: string
  detail: Record<string, unknown>
  status: string
  created_at: string
  resolution_note: string | null
  resolved_at: string | null
  assigned_to: string | null
}

const SEVERITY_ORDER: Record<Flag['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_COLOR: Record<Flag['severity'], string> = {
  critical: 'bg-red-950 border-red-800',
  high: 'bg-orange-950 border-orange-800',
  medium: 'bg-amber-950 border-amber-800',
  low: 'bg-slate-800 border-slate-700',
}

// SPEC.md Section 10.5. Copy discipline (CLAUDE.md invariant 11): every
// title already describes the measurement, not the motive — that's written
// into fn_raise_flag's callers, not this screen, so there's nothing to
// enforce here beyond not adding commentary of our own.
export function Flags({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient()
  const [showResolved, setShowResolved] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: flags, isLoading } = useQuery({
    queryKey: ['flags', showResolved],
    queryFn: async () => {
      let query = supabase.from('flags').select('*').order('created_at', { ascending: false })
      if (!showResolved) query = query.eq('status', 'open')
      const { data, error } = await query
      if (error) throw error
      return (data as Flag[]).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    },
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Flags</h1>
        <button
          className="text-sm text-slate-400 underline"
          onClick={() => setShowResolved((v) => !v)}
        >
          {showResolved ? 'Show open only' : 'Show all'}
        </button>
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {flags?.length === 0 && <p className="text-slate-400">No open flags.</p>}

      <div className="space-y-3">
        {flags?.map((f) => (
          <FlagCard
            key={f.id}
            flag={f}
            user={user}
            expanded={expanded === f.id}
            onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['flags'] })}
          />
        ))}
      </div>
    </div>
  )
}

function FlagCard({
  flag,
  user,
  expanded,
  onToggle,
  onChanged,
}: {
  flag: Flag
  user: CurrentUser
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: photoUrl } = useQuery({
    queryKey: ['flag-photo', flag.entity_type, flag.entity_id],
    queryFn: async () => {
      const weighmentId = flag.entity_type === 'weighment' ? flag.entity_id : null
      if (!weighmentId) return null
      const { data } = await supabase.from('weighments').select('photo_path').eq('id', weighmentId).maybeSingle()
      if (!data) return null
      return getSignedPhotoUrl(data.photo_path, 60)
    },
    enabled: expanded && flag.entity_type === 'weighment',
  })

  const { data: history } = useQuery({
    queryKey: ['flag-history', flag.entity_type, flag.entity_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('flags')
        .select('id, title, status, resolution_note, resolved_at')
        .eq('entity_type', flag.entity_type)
        .eq('entity_id', flag.entity_id)
        .neq('status', 'open')
        .order('resolved_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: expanded,
  })

  const { data: assignees } = useQuery({
    queryKey: ['flag-assignees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('profile_id, profiles!inner(id, full_name)')
        .in('role', ['owner', 'supervisor'])
      if (error) throw error
      return (data ?? []).map((r) => r.profiles as unknown as { id: string; full_name: string })
    },
    enabled: expanded,
  })

  const assign = useMutation({
    mutationFn: async (assigneeId: string) => {
      const { error } = await supabase.from('flags').update({ assigned_to: assigneeId }).eq('id', flag.id)
      if (error) throw error
    },
    onSuccess: onChanged,
  })

  const resolve = useMutation({
    mutationFn: async (status: 'explained' | 'confirmed' | 'dismissed') => {
      if (status === 'explained' && note.trim().length === 0) {
        throw new Error('A note is required to mark this explained.')
      }
      const { error } = await supabase
        .from('flags')
        .update({
          status,
          resolution_note: note || null,
          resolved_by: user.profileId,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', flag.id)
      if (error) throw error
    },
    onSuccess: () => {
      setNote('')
      onChanged()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${SEVERITY_COLOR[flag.severity]}`}>
      <button className="text-left w-full" onClick={onToggle}>
        <p className="font-medium">{flag.title}</p>
        <p className="text-xs text-slate-400">
          {flag.code} · {flag.severity} · {new Date(flag.created_at).toLocaleString()}
          {flag.status !== 'open' ? ` · ${flag.status}` : ''}
        </p>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-700 pt-3">
          <pre className="text-xs text-slate-400 whitespace-pre-wrap">
            {JSON.stringify(flag.detail, null, 2)}
          </pre>

          {photoUrl && (
            <img src={photoUrl} alt="Evidence" className="rounded-lg max-w-full" />
          )}

          {history && history.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Previous resolutions on this {flag.entity_type}:</p>
              {history.map((h) => (
                <p key={h.id} className="text-xs text-slate-500">
                  {h.status}
                  {h.resolution_note ? ` — ${h.resolution_note}` : ''}
                </p>
              ))}
            </div>
          )}

          {flag.status === 'open' && (
            <>
              <label className="block space-y-1">
                <span className="text-xs text-slate-400">Assign to</span>
                <select
                  className="w-full h-touch rounded-lg bg-slate-900 px-3 text-sm"
                  value={flag.assigned_to ?? ''}
                  onChange={(e) => assign.mutate(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {assignees?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <input
                placeholder="Note (required for Explained)"
                className="w-full h-touch rounded-lg bg-slate-900 px-3 text-sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  className="h-touch px-3 rounded-lg bg-blue-600 text-sm"
                  onClick={() => resolve.mutate('explained')}
                  disabled={resolve.isPending}
                >
                  Explained
                </button>
                <button
                  className="h-touch px-3 rounded-lg bg-red-700 text-sm"
                  onClick={() => resolve.mutate('confirmed')}
                  disabled={resolve.isPending}
                >
                  Confirmed
                </button>
                <button
                  className="h-touch px-3 rounded-lg bg-slate-700 text-sm"
                  onClick={() => resolve.mutate('dismissed')}
                  disabled={resolve.isPending}
                >
                  Dismissed
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
