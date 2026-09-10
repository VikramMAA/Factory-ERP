import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../lib/roles'

export interface CurrentUser {
  session: Session
  profileId: string
  fullName: string
  roles: UserRole[]
}

export function useSession() {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined) // undefined = loading

  useEffect(() => {
    let cancelled = false

    async function loadProfile(session: Session) {
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', session.user.id).single(),
        supabase.from('user_roles').select('role').eq('profile_id', session.user.id),
      ])
      if (cancelled) return
      setUser({
        session,
        profileId: session.user.id,
        fullName: profile?.full_name ?? session.user.email ?? 'Unknown',
        roles: (roleRows ?? []).map((r) => r.role as UserRole),
      })
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadProfile(data.session)
      else if (!cancelled) setUser(null)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) loadProfile(session)
      else setUser(null)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return user
}
