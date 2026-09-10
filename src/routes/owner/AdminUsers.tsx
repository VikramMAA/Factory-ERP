import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ALL_ROLES, type UserRole } from '../../lib/roles'
import { isValidUsername } from '../../lib/username'
import { BackLink } from '../../components/BackLink'

interface ProfileRow {
  id: string
  username: string
  full_name: string
  is_active: boolean
  roles: UserRole[]
}

async function fetchProfiles(): Promise<ProfileRow[]> {
  const [{ data: profiles, error: pErr }, { data: roleRows, error: rErr }] = await Promise.all([
    supabase.from('profiles').select('id, username, full_name, is_active').order('full_name'),
    supabase.from('user_roles').select('profile_id, role'),
  ])
  if (pErr) throw pErr
  if (rErr) throw rErr
  return (profiles ?? []).map((p) => ({
    ...p,
    roles: (roleRows ?? []).filter((r) => r.profile_id === p.id).map((r) => r.role as UserRole),
  }))
}

export function AdminUsers() {
  const queryClient = useQueryClient()
  const { data: rows, isLoading, error } = useQuery({ queryKey: ['admin-users'], queryFn: fetchProfiles })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
  }

  return (
    <div className="p-4 space-y-6">
      <BackLink to="/admin" label="Admin" />
      <h1 className="text-xl font-semibold">Users</h1>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {error && <p className="text-red-400">{(error as Error).message}</p>}

      <div className="space-y-3">
        {rows?.map((row) => (
          <UserRow key={row.id} row={row} onChanged={invalidate} />
        ))}
      </div>

      <AddUserForm onCreated={invalidate} />
    </div>
  )
}

function UserRow({ row, onChanged }: { row: ProfileRow; onChanged: () => void }) {
  const [fullName, setFullName] = useState(row.full_name)
  const [expanded, setExpanded] = useState(false)

  const renameMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', row.id)
      if (error) throw error
    },
    onSuccess: onChanged,
  })

  const toggleRole = useMutation({
    mutationFn: async ({ role, enabled }: { role: UserRole; enabled: boolean }) => {
      if (enabled) {
        const { error } = await supabase.from('user_roles').insert({ profile_id: row.id, role })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_roles')
          .delete()
          .eq('profile_id', row.id)
          .eq('role', role)
        if (error) throw error
      }
    },
    onSuccess: onChanged,
  })

  const toggleActive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !row.is_active })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: onChanged,
  })

  return (
    <div className={`rounded-lg p-3 space-y-2 ${row.is_active ? 'bg-slate-800' : 'bg-slate-900 opacity-60'}`}>
      <div className="flex items-center justify-between gap-2">
        <button className="text-left flex-1" onClick={() => setExpanded((v) => !v)}>
          <p className="font-medium">{row.full_name}</p>
          <p className="text-xs text-slate-400">
            @{row.username} · {row.roles.join(', ') || 'no roles'}
            {!row.is_active && ' · inactive'}
          </p>
        </button>
        <button
          className="h-touch px-3 rounded-lg bg-slate-700 text-sm"
          onClick={() => toggleActive.mutate()}
          disabled={toggleActive.isPending}
        >
          {row.is_active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>

      {toggleActive.isError && (
        <p className="text-red-400 text-sm">{(toggleActive.error as Error).message}</p>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-slate-700 pt-3">
          <div className="flex gap-2">
            <input
              className="flex-1 h-touch rounded-lg bg-slate-900 px-3"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <button
              className="h-touch px-4 rounded-lg bg-blue-600 text-sm"
              onClick={() => renameMutation.mutate()}
              disabled={renameMutation.isPending || fullName === row.full_name}
            >
              Save name
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {ALL_ROLES.map((role) => {
              const enabled = row.roles.includes(role)
              return (
                <button
                  key={role}
                  className={`h-touch px-3 rounded-lg text-sm ${
                    enabled ? 'bg-blue-600' : 'bg-slate-900'
                  }`}
                  onClick={() => toggleRole.mutate({ role, enabled: !enabled })}
                  disabled={toggleRole.isPending}
                >
                  {role}
                </button>
              )
            })}
          </div>
          {toggleRole.isError && (
            <p className="text-red-400 text-sm">{(toggleRole.error as Error).message}</p>
          )}

          <UsernameAndPassword userId={row.id} currentUsername={row.username} onChanged={onChanged} />
        </div>
      )}
    </div>
  )
}

function UsernameAndPassword({
  userId,
  currentUsername,
  onChanged,
}: {
  userId: string
  currentUsername: string
  onChanged: () => void
}) {
  const [newUsername, setNewUsername] = useState(currentUsername)
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const usernameMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'update_username', user_id: userId, new_username: newUsername },
      })
      if (error || data?.error) throw new Error(data?.error ?? error?.message)
    },
    onSuccess: () => {
      setMessage('Username updated.')
      onChanged()
    },
    onError: (e: Error) => setMessage(e.message),
  })

  const passwordMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'reset_password', user_id: userId, new_password: newPassword },
      })
      if (error || data?.error) throw new Error(data?.error ?? error?.message)
    },
    onSuccess: () => {
      setMessage('Password reset.')
      setNewPassword('')
    },
    onError: (e: Error) => setMessage(e.message),
  })

  return (
    <div className="space-y-2 border-t border-slate-700 pt-3">
      <div className="flex gap-2">
        <input
          className="flex-1 h-touch rounded-lg bg-slate-900 px-3 lowercase"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
        />
        <button
          className="h-touch px-4 rounded-lg bg-slate-700 text-sm"
          onClick={() => usernameMutation.mutate()}
          disabled={usernameMutation.isPending || newUsername === currentUsername}
        >
          Change username
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          placeholder="New password"
          className="flex-1 h-touch rounded-lg bg-slate-900 px-3"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button
          className="h-touch px-4 rounded-lg bg-slate-700 text-sm"
          onClick={() => passwordMutation.mutate()}
          disabled={passwordMutation.isPending || newPassword.length < 6}
        >
          Reset password
        </button>
      </div>
      {message && <p className="text-sm text-slate-400">{message}</p>}
    </div>
  )
}

function AddUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<UserRole[]>([])
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!isValidUsername(username)) {
        throw new Error('Username must be 3-30 lowercase letters, digits or underscores.')
      }
      if (roles.length === 0) throw new Error('Pick at least one role.')
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'create_user', username, full_name: fullName, password, roles },
      })
      if (error || data?.error) throw new Error(data?.error ?? error?.message)
    },
    onSuccess: () => {
      setUsername('')
      setFullName('')
      setPassword('')
      setRoles([])
      setError(null)
      onCreated()
    },
    onError: (e: Error) => setError(e.message),
  })

  function toggleRole(role: UserRole) {
    setRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]))
  }

  return (
    <div className="space-y-2 border-t border-slate-800 pt-4">
      <p className="font-medium">Add a person</p>
      <input
        placeholder="Full name"
        className="w-full h-touch rounded-lg bg-slate-800 px-3"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <input
        placeholder="Username"
        autoCapitalize="none"
        autoCorrect="off"
        className="w-full h-touch rounded-lg bg-slate-800 px-3 lowercase"
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase())}
      />
      <input
        type="password"
        placeholder="Password"
        className="w-full h-touch rounded-lg bg-slate-800 px-3"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {ALL_ROLES.map((role) => (
          <button
            key={role}
            className={`h-touch px-3 rounded-lg text-sm ${
              roles.includes(role) ? 'bg-blue-600' : 'bg-slate-800'
            }`}
            onClick={() => toggleRole(role)}
          >
            {role}
          </button>
        ))}
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        className="h-touch px-4 rounded-lg bg-blue-600 font-medium"
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
      >
        {createMutation.isPending ? 'Creating…' : 'Add person'}
      </button>
    </div>
  )
}
