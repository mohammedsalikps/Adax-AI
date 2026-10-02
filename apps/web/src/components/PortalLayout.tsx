import { ROLE_LABELS, type Role } from '@adaxai/contracts'
import { Info, KeyRound, LogOut, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useLogout, useMe } from '../lib/auth.tsx'
import { NAV } from '../lib/nav.ts'

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
    isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:bg-canvas hover:text-ink',
  ].join(' ')

/** Shell for a signed-in role: sidebar navigation, user menu and the development notice. */
export function PortalLayout({ role }: { role: Role }) {
  const { data: me } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])

  const signOut = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })
  const items = NAV[role]

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow">
        Skip to main content
      </a>
      <header className="border-b border-line bg-surface print:hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button type="button" className="rounded-md p-2 text-ink-muted hover:bg-canvas lg:hidden" aria-expanded={menuOpen} aria-controls="portal-nav" onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
          <Link to="/" className="flex items-center gap-2 rounded-md">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="font-semibold tracking-tight">ADAXAI</span>
          </Link>
          <span className="hidden rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-brand-strong sm:inline">{ROLE_LABELS[role]} portal</span>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden text-sm text-ink-muted sm:inline" data-testid="signed-in-user">
              {me?.fullName}
            </span>
            <Link to="/change-password" className="rounded-md p-2 text-ink-muted hover:bg-canvas" title="Change password">
              <KeyRound aria-hidden="true" className="size-5" />
              <span className="sr-only">Change password</span>
            </Link>
            <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap text-ink-muted hover:bg-canvas hover:text-ink">
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div role="note" className="border-b border-line bg-notice-soft text-notice print:hidden">
        <p className="flex items-start gap-2 px-4 py-1.5 text-xs">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="font-semibold">Development build.</strong> Synthetic data only. Not for clinical use. Not a medical device.
          </span>
        </p>
      </div>

      <div className="flex flex-1">
        <nav id="portal-nav" aria-label={`${ROLE_LABELS[role]} navigation`} className={`${menuOpen ? 'block' : 'hidden'} absolute inset-x-0 z-30 border-b border-line bg-surface p-3 shadow-lg lg:static lg:block lg:w-56 lg:shrink-0 lg:border-r lg:border-b-0 lg:shadow-none print:hidden`}>
          <ul className="space-y-1">
            {items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={navClass}>
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
