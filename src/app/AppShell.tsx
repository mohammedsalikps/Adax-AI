import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { RouteFallback } from './RouteFallback'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/** Application frame: icon rail on the left, topbar above the routed page. */
export function AppShell() {
  // h-dvh, not h-screen: on a mobile browser the address bar resizes the
  // viewport, and 100vh leaves the action bar underneath it.
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {/* Suspense sits inside the shell, so the sidebar and topbar stay
            usable while a lazily loaded screen is being fetched. */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
