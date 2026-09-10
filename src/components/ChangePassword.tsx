import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Usernames are synthetic emails (@rewind.local) that can't receive mail, so
// there's no self-service "forgot password" flow. This is the alternative:
// any signed-in person can set their own password directly, using their
// current session — no admin needed. Owners resetting someone else's
// password is a separate action in /admin/users that goes through the
// admin-users Edge Function instead.
export function ChangePassword() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage('Password changed.')
    setPassword('')
  }

  if (!open) {
    return (
      <button className="text-sm text-slate-400 underline" onClick={() => setOpen(true)}>
        Change my password
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <input
        type="password"
        placeholder="New password"
        className="w-full h-touch rounded-lg bg-slate-800 px-3"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {message && <p className="text-sm text-slate-400">{message}</p>}
      <button
        className="h-touch px-4 rounded-lg bg-blue-600 text-sm font-medium"
        onClick={submit}
        disabled={busy}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
