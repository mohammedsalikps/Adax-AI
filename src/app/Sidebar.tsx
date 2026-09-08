import { NavLink, useMatch } from 'react-router-dom'
import { CalendarCheck, Info, Search, Stethoscope, UserPlus } from 'lucide-react'
import { cn } from '@/lib/cn'

interface NavItem {
  to: string
  label: string
  icon: typeof CalendarCheck
  end?: boolean
}

/**
 * Primary navigation. Every entry points at a route that exists — a nav item
 * that leads nowhere is worse than an absent one, so sections without screens
 * yet are simply not listed.
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: "Today's Clinic", icon: CalendarCheck, end: true },
  { to: '/patients/search', label: 'Search', icon: Search },
  { to: '/patients/new', label: 'Register', icon: UserPlus },
]

const LINK_BASE =
  'group flex w-full flex-col items-center gap-1 rounded-panel px-2 py-2.5 text-[11px] font-medium transition-colors'

export function Sidebar() {
  // Consultations are reached from a patient rather than from navigation, so
  // the entry reflects the open consultation instead of linking somewhere.
  const consultationMatch = useMatch('/consultation/:patientId')

  return (
    <nav
      aria-label="Primary"
      className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface px-2 py-3 lg:w-[116px] lg:px-3"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={label}
          className={({ isActive }) =>
            cn(
              LINK_BASE,
              isActive
                ? 'bg-accent-soft text-accent-ink'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink-soft',
            )
          }
        >
          <Icon size={19} aria-hidden />
          <span className="hidden text-center leading-tight lg:block">{label}</span>
          <span className="sr-only lg:hidden">{label}</span>
        </NavLink>
      ))}

      {/* Not a link: it marks where the doctor already is. */}
      <div
        aria-current={consultationMatch ? 'page' : undefined}
        title={
          consultationMatch
            ? 'A consultation is open'
            : 'Open a consultation from the clinic queue or a patient chart'
        }
        className={cn(
          LINK_BASE,
          consultationMatch
            ? 'bg-accent-soft text-accent-ink'
            : 'text-ink-muted/60',
        )}
      >
        <Stethoscope size={19} aria-hidden />
        <span className="hidden text-center leading-tight lg:block">Consultation</span>
        <span className="sr-only lg:hidden">
          {consultationMatch ? 'Consultation open' : 'Consultation — none open'}
        </span>
      </div>

      <div className="mt-auto w-full">
        <div className="rounded-panel border border-dashed border-line bg-surface-alt p-2 text-center">
          <Info size={14} className="mx-auto text-ink-muted" aria-hidden />
          <p className="mt-1 hidden text-[10px] leading-tight font-semibold text-ink-soft lg:block">
            Demonstration Mode
          </p>
          <p className="mt-0.5 hidden text-[10px] leading-tight text-ink-muted lg:block">
            All data is fictional.
          </p>
          <span className="sr-only lg:hidden">
            Demonstration mode — all data is fictional.
          </span>
        </div>
      </div>
    </nav>
  )
}
