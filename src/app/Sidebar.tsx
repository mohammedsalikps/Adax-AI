import { NavLink } from 'react-router-dom'
import { Activity, CalendarCheck, Search, UserPlus } from 'lucide-react'
import { cn } from '@/lib/cn'

interface NavItem {
  to: string
  label: string
  icon: typeof CalendarCheck
  end?: boolean
}

/**
 * Primary navigation. Consultations are reached from a patient — the queue,
 * a search result or a chart — so there is no standalone entry for them.
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: "Today's Clinic", icon: CalendarCheck, end: true },
  { to: '/patients/search', label: 'Find Patient', icon: Search },
  { to: '/patients/new', label: 'Register Patient', icon: UserPlus },
]

export function Sidebar() {
  return (
    <nav
      aria-label="Primary"
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3"
    >
      <div className="mb-4 flex size-9 items-center justify-center rounded-control bg-accent text-ink-inverse">
        <Activity size={18} strokeWidth={2.5} aria-hidden />
        <span className="sr-only">MedConsult</span>
      </div>

      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={label}
          className={({ isActive }) =>
            cn(
              'group relative flex size-10 items-center justify-center rounded-control transition-colors',
              isActive
                ? 'bg-accent-soft text-accent-ink'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink-soft',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span
                  aria-hidden
                  className="absolute -left-3 h-5 w-[3px] rounded-r bg-accent"
                />
              )}
              <Icon size={18} aria-hidden />
              <span className="sr-only">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
