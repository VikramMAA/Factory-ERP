// Owner-only user administration. This is the one place in the app that
// touches auth.users directly, which is why it exists as an Edge Function
// instead of a Postgres RPC: Postgres has no way to call the Auth Admin API,
// and the service role key it needs must never reach the browser (see
// CLAUDE.md invariant 7). Everything else about role/name management (roles,
// full_name, is_active) goes through ordinary table calls guarded by RLS —
// only login creation, password resets and username changes land here.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const USERNAME_RE = /^[a-z0-9_]{3,30}$/
const EMAIL_DOMAIN = '@rewind.local'
const ALL_ROLES = ['owner', 'supervisor', 'operator', 'packer', 'driver', 'order_taker']

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const action = body.action

  // Identify the caller, if any. Bootstrap (creating the very first owner)
  // is the only action allowed with no caller at all.
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  let callerId: string | null = null
  if (token && token !== anonKey) {
    const asCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data } = await asCaller.auth.getUser()
    callerId = data.user?.id ?? null
  }

  async function callerIsOwner(): Promise<boolean> {
    if (!callerId) return false
    const { data: profile } = await admin
      .from('profiles')
      .select('is_active')
      .eq('id', callerId)
      .maybeSingle()
    if (!profile?.is_active) return false
    const { data: role } = await admin
      .from('user_roles')
      .select('role')
      .eq('profile_id', callerId)
      .eq('role', 'owner')
      .maybeSingle()
    return !!role
  }

  if (action === 'create_user') {
    const { username, full_name, password, roles } = body as {
      username?: string
      full_name?: string
      password?: string
      roles?: string[]
    }
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return json({ error: 'Username must be 3-30 lowercase letters, digits or underscores.' }, 400)
    }
    if (typeof full_name !== 'string' || full_name.trim().length === 0) {
      return json({ error: 'Full name is required.' }, 400)
    }
    if (typeof password !== 'string' || password.length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400)
    }
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => ALL_ROLES.includes(r))) {
      return json({ error: 'At least one valid role is required.' }, 400)
    }

    const { count: ownerCount } = await admin
      .from('user_roles')
      .select('profile_id', { count: 'exact', head: true })
      .eq('role', 'owner')

    const isBootstrap = (ownerCount ?? 0) === 0
    if (isBootstrap) {
      if (!roles.includes('owner')) {
        return json({ error: 'No owner exists yet. The first user created must be an owner.' }, 400)
      }
    } else if (!(await callerIsOwner())) {
      return json({ error: 'Only an owner can create users.' }, 403)
    }

    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()
    if (existing) {
      return json({ error: `Username "${username}" is already taken.` }, 409)
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: `${username}${EMAIL_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { full_name, username },
    })
    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Failed to create login.' }, 400)
    }

    const { error: profileErr } = await admin
      .from('profiles')
      .insert({ id: created.user.id, username, full_name })
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: `Failed to save profile: ${profileErr.message}` }, 400)
    }

    const { error: rolesErr } = await admin
      .from('user_roles')
      .insert(roles.map((role) => ({ profile_id: created.user!.id, role })))
    if (rolesErr) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: `Failed to assign roles: ${rolesErr.message}` }, 400)
    }

    return json({ id: created.user.id, username, full_name, roles })
  }

  if (action === 'reset_password') {
    if (!(await callerIsOwner())) return json({ error: 'Only an owner can do this.' }, 403)
    const { user_id, new_password } = body as { user_id?: string; new_password?: string }
    if (typeof user_id !== 'string') return json({ error: 'user_id is required.' }, 400)
    if (typeof new_password !== 'string' || new_password.length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400)
    }
    const { error } = await admin.auth.admin.updateUserById(user_id, { password: new_password })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'update_username') {
    if (!(await callerIsOwner())) return json({ error: 'Only an owner can do this.' }, 403)
    const { user_id, new_username } = body as { user_id?: string; new_username?: string }
    if (typeof user_id !== 'string') return json({ error: 'user_id is required.' }, 400)
    if (typeof new_username !== 'string' || !USERNAME_RE.test(new_username)) {
      return json({ error: 'Username must be 3-30 lowercase letters, digits or underscores.' }, 400)
    }
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('username', new_username)
      .maybeSingle()
    if (existing && existing.id !== user_id) {
      return json({ error: `Username "${new_username}" is already taken.` }, 409)
    }
    const { error: authErr } = await admin.auth.admin.updateUserById(user_id, {
      email: `${new_username}${EMAIL_DOMAIN}`,
    })
    if (authErr) return json({ error: authErr.message }, 400)
    const { error: profErr } = await admin
      .from('profiles')
      .update({ username: new_username })
      .eq('id', user_id)
    if (profErr) return json({ error: profErr.message }, 400)
    return json({ ok: true })
  }

  return json({ error: `Unknown action "${String(action)}".` }, 400)
})
