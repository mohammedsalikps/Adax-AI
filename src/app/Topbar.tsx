import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical, Search } from 'lucide-react'
import { DemoDrawer } from '@/features/demo/DemoDrawer'
import { formatLongDate, initialsOf } from '@/lib/format'
import { DEMO_DOCTOR } from '@/mock/doctor'

export function Topbar() {
  const navigate = useNavigate()
  const [demoOpen, setDemoOpen] = useState(false)

  // The keyboard hint on the search control has to be real, so Ctrl/Cmd+K
  // opens the patient directory.
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k') return
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      navigate('/patients/search')
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [navigate])

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold tracking-tight text-ink">
          {DEMO_DOCTOR.clinicName}
        </h1>
        <p className="truncate text-xs whitespace-nowrap text-ink-muted">
          {formatLongDate(new Date())} · Demonstration data
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate('/patients/search')}
        className="ml-auto flex h-9 w-full max-w-72 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-surface-alt px-3 text-left text-ink-muted transition-colors hover:border-line-strong hover:text-ink-soft"
      >
        <Search size={15} className="shrink-0" aria-hidden />
        <span className="truncate text-xs">Search patient by ID or name</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-ink-muted sm:block">
          Ctrl K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setDemoOpen(true)}
        title="Demo guide and demo data tools"
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-control border border-dashed border-line px-2.5 text-[11px] font-semibold text-ink-muted transition-colors hover:border-line-strong hover:text-ink-soft"
      >
        <FlaskConical size={14} aria-hidden />
        <span className="hidden sm:inline">Demo</span>
        <span className="sr-only sm:hidden">Demo guide</span>
      </button>

      <div className="flex items-center gap-2.5 border-l border-line pl-4">
        <div
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink"
        >
          {initialsOf(DEMO_DOCTOR.fullName)}
        </div>
        <div className="hidden leading-tight whitespace-nowrap md:block">
          <p className="text-xs font-semibold text-ink">{DEMO_DOCTOR.fullName}</p>
          <p className="hidden text-[11px] text-ink-muted lg:block">
            {DEMO_DOCTOR.qualifications}
          </p>
        </div>
        {/* The name is hidden below md, so keep it available to assistive tech. */}
        <span className="sr-only md:hidden">
          Signed in as {DEMO_DOCTOR.fullName}
        </span>
      </div>

      <DemoDrawer open={demoOpen} onClose={() => setDemoOpen(false)} />
    </header>
  )
}
