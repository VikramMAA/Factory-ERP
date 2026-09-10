import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { CurrentUser } from '../../hooks/useSession'
import { BackLink } from '../../components/BackLink'

// Daily one-minute task. Blocks nothing; a missed check is a single daily flag
// from fn_daily_checks (Phase 4), not a per-job nag. See SPEC.md Section 9.2.
export function Calibration({ user }: { user: CurrentUser }) {
  const { data: checkedToday } = useQuery({
    queryKey: ['calibration-today'],
    queryFn: async () => {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('calibration_checks')
        .select('id')
        .gte('checked_at', startOfDay.toISOString())
        .limit(1)
      if (error) throw error
      return (data?.length ?? 0) > 0
    },
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Daily scale check</h1>
      <p className="text-slate-400">
        Weigh the 5 kg reference weight, photograph the display, and log it below.
        Takes about a minute. Signed in as {user.fullName}.
      </p>
      <p className={checkedToday ? 'text-emerald-400' : 'text-amber-400'}>
        {checkedToday === undefined
          ? 'Checking…'
          : checkedToday
            ? 'Already logged today'
            : 'Not yet logged today'}
      </p>
      {/* Full weighment capture flow (photo, scale select, submit) lands in
          Phase 1 alongside WeighmentCapture — see SPEC.md Section 10.2. */}
    </div>
  )
}
