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
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx'
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
  { path: '/activate', element: <NotYetBuiltPage title="Activate patient account" planned={['Activate with your MRN and the code from the clinic']} /> },
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
      { index: true, element: <NotYetBuiltPage title="OPD queue" planned={["Today's patients waiting for you"]} /> },
      { path: '*', element: <NotYetBuiltPage title="Doctor portal" planned={['Patients, consultations, thermal']} /> },
    ],
  },
  {
    path: '/nurse',
    element: portal('nurse'),
    children: [
      { index: true, element: <NotYetBuiltPage title="OPD queue" planned={['Check-in, tokens and vitals']} /> },
      { path: '*', element: <NotYetBuiltPage title="Nurse portal" planned={['Registration, patients, devices']} /> },
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
