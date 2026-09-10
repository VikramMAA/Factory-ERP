import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isValidUsername, usernameToEmail } from '../../lib/username'

export function Login() {
  // Until we know whether an owner exists, we can't tell whether to show a
  // login form or the one-time "create the first owner" setup form. Fail
  // toward showing login (the common case) rather than blocking on this.
  const [ownerExists, setOwnerExists] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .rpc('fn_owner_exists')
      .then(({ data, error }) => {
        if (!cancelled) setOwnerExists(error ? true : Boolean(data))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (ownerExists === false) {
    return <FirstOwnerSetup onDone={() => setOwnerExists(true)} />
  }
  return <SignIn />
}

function SignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    })
    setBusy(false)
    if (error) setError('Wrong username or password.')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold text-center mb-6">Rewind Ops</h1>
        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full h-touch rounded-lg bg-slate-800 px-4 text-lg lowercase"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          required
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          className="w-full h-touch rounded-lg bg-slate-800 px-4 text-lg"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full h-touch rounded-lg bg-blue-600 text-lg font-medium disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// Shown only while the system has never had an owner. Calls admin-users
// directly with no session — the function itself allows exactly this one
// unauthenticated case (see supabase/functions/admin-users). Once an owner
// exists this form can never be reached again, by anyone.
function FirstOwnerSetup({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isValidUsername(username)) {
      setError('Username must be 3-30 lowercase letters, digits or underscores.')
      return
    }
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'create_user', username, full_name: fullName, password, roles: ['owner'] },
    })
    setBusy(false)
    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? 'Setup failed.')
      return
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    })
    if (signInError) {
      setError('Owner account created — please sign in.')
      onDone()
      return
    }
    onDone()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold text-center mb-2">Set up Rewind Ops</h1>
        <p className="text-slate-400 text-sm text-center mb-6">
          No owner account exists yet. Create the first one — this form disappears
          for good once it's done, and you'll add everyone else from Admin → Users.
        </p>
        <input
          type="text"
          placeholder="Your name"
          className="w-full h-touch rounded-lg bg-slate-800 px-4 text-lg"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Choose a username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full h-touch rounded-lg bg-slate-800 px-4 text-lg lowercase"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          required
        />
        <input
          type="password"
          placeholder="Choose a password"
          autoComplete="new-password"
          className="w-full h-touch rounded-lg bg-slate-800 px-4 text-lg"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full h-touch rounded-lg bg-blue-600 text-lg font-medium disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create owner account'}
        </button>
      </form>
    </div>
  )
}
