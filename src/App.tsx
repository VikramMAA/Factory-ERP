import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './hooks/useSession'
import { Login } from './routes/shared/Login'
import { Home } from './routes/shared/Home'
import { Calibration } from './routes/shared/Calibration'
import { Admin } from './routes/owner/Admin'
import { JobNew } from './routes/operator/JobNew'
import { JobDetail } from './routes/operator/JobDetail'
import { Jobs } from './routes/operator/Jobs'
import { Stock } from './routes/supervisor/Stock'
import { CountsNew } from './routes/supervisor/CountsNew'
import { Customers } from './routes/sales/Customers'
import { OrdersNew } from './routes/sales/OrdersNew'
import { OrdersList } from './routes/sales/OrdersList'
import { Pack } from './routes/packer/Pack'
import { PackDetail } from './routes/packer/PackDetail'
import { Trip } from './routes/driver/Trip'
import { TripStop } from './routes/driver/TripStop'
import { Cash } from './routes/driver/Cash'
import { Flags } from './routes/owner/Flags'
import { Dashboard } from './routes/owner/Dashboard'
import { ReportsVariance } from './routes/owner/ReportsVariance'
import { supabaseConfigError } from './lib/supabase'
import { isSupervisorUp } from './lib/roles'

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
        path="/job/new"
        element={user.roles.includes('operator') ? <JobNew user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/job/:id"
        element={user.roles.includes('operator') ? <JobDetail user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/jobs"
        element={user.roles.includes('operator') ? <Jobs user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/stock"
        element={isSupervisorUp(user.roles) ? <Stock /> : <Navigate to="/" replace />}
      />
      <Route
        path="/counts/new"
        element={isSupervisorUp(user.roles) ? <CountsNew user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/customers"
        element={
          user.roles.includes('order_taker') || isSupervisorUp(user.roles) ? (
            <Customers />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/orders/new"
        element={
          user.roles.includes('order_taker') || isSupervisorUp(user.roles) ? (
            <OrdersNew user={user} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/orders"
        element={
          user.roles.includes('order_taker') || isSupervisorUp(user.roles) ? (
            <OrdersList user={user} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/pack"
        element={
          user.roles.includes('packer') || isSupervisorUp(user.roles) ? <Pack /> : <Navigate to="/" replace />
        }
      />
      <Route
        path="/pack/:orderId"
        element={
          user.roles.includes('packer') || isSupervisorUp(user.roles) ? (
            <PackDetail user={user} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/trip"
        element={
          user.roles.includes('driver') || isSupervisorUp(user.roles) ? (
            <Trip user={user} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/trip/stop/:id"
        element={
          user.roles.includes('driver') || isSupervisorUp(user.roles) ? (
            <TripStop user={user} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/cash"
        element={
          user.roles.includes('driver') || isSupervisorUp(user.roles) ? (
            <Cash user={user} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/flags"
        element={isSupervisorUp(user.roles) ? <Flags user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/dashboard"
        element={user.roles.includes('owner') ? <Dashboard /> : <Navigate to="/" replace />}
      />
      <Route
        path="/reports/variance"
        element={user.roles.includes('owner') ? <ReportsVariance /> : <Navigate to="/" replace />}
      />
      {/* A route guard redirects; it must never render nothing. RoleGate is for
          hiding buttons, and returning null here would just blank the screen. */}
      <Route
        path="/admin/*"
        element={user.roles.includes('owner') ? <Admin /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
