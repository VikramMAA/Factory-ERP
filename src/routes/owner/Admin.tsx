import { Link, Route, Routes } from 'react-router-dom'
import { AdminCrudTable } from './AdminCrudTable'
import { AdminUsers } from './AdminUsers'
import { AdminMachineOperators } from './AdminMachineOperators'
import { BackLink } from '../../components/BackLink'

const sections = [
  { path: 'products', label: 'Products' },
  { path: 'tube-types', label: 'Tube types' },
  { path: 'packaging', label: 'Packaging' },
  { path: 'machines', label: 'Machines' },
  { path: 'scales', label: 'Scales' },
  { path: 'users', label: 'Users & roles' },
  { path: 'machine-operators', label: 'Machine assignments' },
]

function AdminIndex() {
  return (
    <div className="p-4 space-y-2">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold mb-4">Admin</h1>
      {sections.map((s) => (
        <Link
          key={s.path}
          to={s.path}
          className="block h-touch rounded-lg bg-slate-800 px-4 flex items-center"
        >
          {s.label}
        </Link>
      ))}
    </div>
  )
}

export function Admin() {
  return (
    <Routes>
      <Route index element={<AdminIndex />} />
      <Route
        path="products"
        element={
          <AdminCrudTable
            table="products"
            title="Products"
            fields={[
              { name: 'code', label: 'Code' },
              { name: 'name', label: 'Name' },
              { name: 'category', label: 'Category' },
              { name: 'target_net_g', label: 'Target net (g)', type: 'number' },
              { name: 'tolerance_pct', label: 'Tolerance %', type: 'number' },
              { name: 'price_floor_paise', label: 'Price floor (paise)', type: 'number' },
            ]}
          />
        }
      />
      <Route
        path="tube-types"
        element={
          <AdminCrudTable
            table="tube_types"
            title="Tube types"
            fields={[
              { name: 'code', label: 'Code' },
              { name: 'name', label: 'Name' },
              { name: 'tare_g', label: 'Tare (g)', type: 'number' },
            ]}
          />
        }
      />
      <Route
        path="packaging"
        element={
          <AdminCrudTable
            table="packaging"
            title="Packaging"
            fields={[
              { name: 'code', label: 'Code' },
              { name: 'name', label: 'Name' },
              { name: 'kind', label: 'Kind (box/cover/tray)' },
              { name: 'tare_g', label: 'Tare (g)', type: 'number' },
            ]}
          />
        }
      />
      <Route
        path="machines"
        element={
          <AdminCrudTable
            table="machines"
            title="Machines"
            fields={[
              { name: 'code', label: 'Code' },
              { name: 'name', label: 'Name' },
            ]}
          />
        }
      />
      <Route
        path="scales"
        element={
          <AdminCrudTable
            table="scales"
            title="Scales"
            fields={[
              { name: 'code', label: 'Code' },
              { name: 'location', label: 'Location' },
              { name: 'capacity_g', label: 'Capacity (g)', type: 'number' },
            ]}
          />
        }
      />
      <Route path="users" element={<AdminUsers />} />
      <Route path="machine-operators" element={<AdminMachineOperators />} />
    </Routes>
  )
}
