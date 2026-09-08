import { RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/app/AppProviders'
import { router } from '@/router/routes'

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
