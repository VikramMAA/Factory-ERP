import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './hooks/useSession'
import { Login } from './routes/shared/Login'
import { Home } from './routes/shared/Home'
import { Calibration } from './routes/shared/Calibration'
import { Admin } from './routes/owner/Admin'
import { RoleGate } from './components/RoleGate'
import { supabaseConfigError } from './lib/supabase'

export default function App() {
  if (supabaseConfigError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm space-y-2 text-center">
          <p className="text-red-400 font-medium">Configuration error</p>
          <p className="text-slate-400 text-sm">{supabaseConfigError}</p>
          <p className="text-slate-500 text-xs">
            Set these in the hosting provider's environment variables and redeploy.
          </p>
        </div>
      </div>
    )
  }

  return <AppRoutes />
}

function AppRoutes() {
  const user = useSession()

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>
  }

  if (user === null) {
    return <Login />
  }

  return (
    <Routes>
      <Route path="/" element={<Home user={user} />} />
      <Route path="/calibration" element={<Calibration user={user} />} />
      <Route
        path="/admin/*"
        element={
          <RoleGate roles={user.roles} allow={['owner']}>
            <Admin />
          </RoleGate>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
