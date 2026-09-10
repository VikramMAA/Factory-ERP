import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Throwing here would happen at module-import time, before React mounts —
// the whole app goes blank with nothing but a console error. Surface it as
// on-screen state instead (see App.tsx) so a misconfigured deploy is obvious
// rather than silent.
export const supabaseConfigError =
  !url || !anonKey ? 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.' : null

// Single instance. Never construct another client elsewhere. Falls back to
// placeholder values when misconfigured so importing this module never
// crashes the app before it can render supabaseConfigError.
export const supabase = createClient(url || 'https://placeholder.invalid', anonKey || 'placeholder')
