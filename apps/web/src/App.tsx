import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppShell } from './components/AppShell.tsx'
import { PORTALS } from './lib/portals.ts'
import { HomePage } from './pages/HomePage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { PortalPage } from './pages/PortalPage.tsx'

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      ...PORTALS.map((portal) => ({ path: portal.path, element: <PortalPage portal={portal} /> })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
