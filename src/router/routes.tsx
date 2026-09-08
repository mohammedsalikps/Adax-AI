import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'
import { NotFoundPage } from '@/app/NotFoundPage'
import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { QueuePage } from '@/features/queue/QueuePage'
import {
  ComponentShowcasePage,
  ConsultationPage,
  CrashProbe,
  PatientProfilePage,
  PatientRegistrationPage,
  PatientSearchPage,
} from './lazyRoutes'

/**
 * Route table for the doctor console. Each screen renders inside AppShell,
 * which provides the Suspense boundary for the lazy chunks.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <QueuePage />, errorElement: <RouteErrorBoundary /> },
      {
        path: 'patients/new',
        element: <PatientRegistrationPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'patients/search',
        element: <PatientSearchPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'patients/:patientId',
        element: <PatientProfilePage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'consultation/:patientId',
        element: <ConsultationPage />,
        errorElement: <RouteErrorBoundary />,
      },
      // Component gallery: development only, and never in navigation.
      ...(ComponentShowcasePage
        ? [
            {
              path: 'components',
              element: <ComponentShowcasePage />,
              errorElement: <RouteErrorBoundary />,
            },
          ]
        : []),
      ...(CrashProbe
        ? [
            {
              path: '__crash-probe',
              element: <CrashProbe />,
              errorElement: <RouteErrorBoundary />,
            },
          ]
        : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
