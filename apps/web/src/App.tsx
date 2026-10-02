import type { Role } from '@adaxai/contracts'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import { PortalLayout } from './components/PortalLayout.tsx'
import { RequireAuth, RoleRedirect } from './components/RequireAuth.tsx'
import { ToastProvider } from './components/ui/Toast.tsx'
import { createQueryClient } from './lib/queryClient.ts'
import { AdminAuditPage } from './pages/admin/AdminAuditPage.tsx'
import { AdminDepartmentsPage } from './pages/admin/AdminDepartmentsPage.tsx'
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage.tsx'
import { AdminUsersPage } from './pages/admin/AdminUsersPage.tsx'
import { ActivatePage } from './pages/ActivatePage.tsx'
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx'
import { PatientProfilePage } from './pages/clinical/PatientProfilePage.tsx'
import { PatientsPage } from './pages/clinical/PatientsPage.tsx'
import { QueuePage } from './pages/clinical/QueuePage.tsx'
import { RegisterPatientPage } from './pages/clinical/RegisterPatientPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { NotYetBuiltPage } from './pages/NotYetBuiltPage.tsx'

const portal = (role: Role) => (
  <RequireAuth roles={[role]}>
    <PortalLayout role={role} />
  </RequireAuth>
)

const router = createBrowserRouter([
  { path: '/', element: <RoleRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/activate', element: <ActivatePage /> },
  {
    path: '/change-password',
    element: (
      <RequireAuth allowPasswordChange>
        <ChangePasswordPage />
      </RequireAuth>
    ),
  },
  {
    path: '/admin',
    element: portal('admin'),
    children: [
      { index: true, element: <AdminOverviewPage /> },
      { path: 'users', element: <AdminUsersPage /> },
      { path: 'departments', element: <AdminDepartmentsPage /> },
      { path: 'devices', element: <NotYetBuiltPage title="Devices" planned={['Device registry (band, stethoscope, thermal camera)']} /> },
      { path: 'thermal-data', element: <NotYetBuiltPage title="Thermal data" planned={['Label taxonomy', 'Dataset export']} /> },
      { path: 'audit', element: <AdminAuditPage /> },
    ],
  },
  {
    path: '/doctor',
    element: portal('doctor'),
    children: [
      { index: true, element: <QueuePage /> },
      { path: 'patients', element: <PatientsPage /> },
      { path: 'patients/:patientId', element: <PatientProfilePage /> },
      { path: 'register', element: <RegisterPatientPage /> },
      { path: 'thermal', element: <NotYetBuiltPage title="Thermal" planned={['FLIR image upload and analysis']} /> },
    ],
  },
  {
    path: '/nurse',
    element: portal('nurse'),
    children: [
      { index: true, element: <QueuePage /> },
      { path: 'register', element: <RegisterPatientPage /> },
      { path: 'patients', element: <PatientsPage /> },
      { path: 'patients/:patientId', element: <PatientProfilePage /> },
      { path: 'devices', element: <NotYetBuiltPage title="Devices" planned={['Device assignment and readings']} /> },
    ],
  },
  {
    path: '/patient',
    element: portal('patient'),
    children: [{ path: '*', element: <NotYetBuiltPage title="Patient portal" planned={['Visits, prescriptions, vitals, consents']} /> }],
  },
  { path: '*', element: <Outlet />, children: [{ path: '*', element: <NotFoundPage /> }] },
])

export function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
