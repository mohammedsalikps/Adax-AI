import { ArrowLeft } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { fmtDateTime, fmtTime } from '../../lib/format.ts'
import { Badge } from '../ui/Feedback.tsx'

/** Time since the consultation was started, as m:ss or h:mm:ss; null once it has run long enough that a clock stops being useful. */
export function useElapsed(startedAt: string): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  if (s > 4 * 3600) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** Whether `ref`'s element is on screen (below the top bars). True where the browser cannot tell, so nothing extra is shown. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    // The sticky bars cover the top of the viewport (the application bar and this header): the element counts as gone once it is behind them.
    // Fully in view or not: the name and the allergy chips are at the top of the banner, so the strip takes over as soon as any of it is behind the bars.
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry && entry.intersectionRatio >= 0.98), { rootMargin: '-120px 0px 0px 0px', threshold: [0.98] })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return visible
}

/**
 * Publishes the height of the bar that is fixed to the bottom of the screen below 1024px as `--action-bar-h`, so the page can leave exactly
 * that much room (and keep focused controls clear of it). It is 0 where the bar is not fixed.
 */
function useActionBarHeight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--action-bar-h', getComputedStyle(el).position === 'fixed' ? `${el.offsetHeight}px` : '0px')
    apply()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    ro?.observe(el)
    window.addEventListener('resize', apply)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', apply)
      root.style.removeProperty('--action-bar-h')
    }
  }, [ref])
}

/**
 * The bar above a consultation: the way back, the title, that the consultation
 * is in progress and for how long, and its actions (save state, save, complete,
 * more). From 1024px wide it stays at the top of the page; on narrower screens
 * the actions stay at the bottom of the screen (a bar whose height is measured,
 * and which never takes more than 45% of it), so the save
 * state and "Complete consultation" are never scrolled away. When the patient
 * banner has scrolled out of view, `patient` (name, MRN, allergies) is shown
 * with the bar instead, so the prescriber always sees who this is and what they
 * are allergic to. The elapsed time is for the eye only; it is not announced every second.
 */
export function ConsultationHeader({ patientName, startedAt, backTo, backLabel, actions, patient }: { patientName: string; startedAt: string; backTo: string; backLabel: string; actions?: ReactNode; patient?: ReactNode }) {
  const elapsed = useElapsed(startedAt)
  const bar = useRef<HTMLDivElement>(null)
  useActionBarHeight(bar)
  return (
    <header className="relative mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:sticky lg:top-topbar lg:z-20 lg:-mx-8 lg:border-b lg:border-line lg:bg-canvas/95 lg:px-8 lg:py-2.5 lg:backdrop-blur" data-testid="consultation-header">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Link to={backTo} className="inline-flex size-control-sm items-center justify-center rounded-md text-ink-muted hover:bg-surface hover:text-ink">
          <ArrowLeft aria-hidden="true" className="size-5" />
          <span className="sr-only">{backLabel}</span>
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          Consultation
          <span className="sr-only"> for {patientName}</span>
        </h1>
        <Badge tone="ok" dot>
          Draft · in progress
        </Badge>
        <p className="text-sm text-ink-muted tabular-nums">
          {elapsed ? (
            <>
              <span aria-hidden="true">{elapsed}</span>
              <span className="sr-only">Started at {fmtTime(startedAt)}</span>
            </>
          ) : (
            <>Started {fmtDateTime(startedAt)}</>
          )}
        </p>
      </div>
      <div ref={bar} className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:max-h-[45dvh] max-lg:overflow-y-auto max-lg:border-t max-lg:border-line max-lg:bg-surface max-lg:px-4 max-lg:py-2 max-lg:shadow-pop" data-testid="consultation-actions">
        {patient && <div className="mb-2 lg:hidden">{patient}</div>}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {patient && <div className="absolute inset-x-0 top-full hidden border-b border-line bg-canvas/95 px-8 py-1.5 backdrop-blur lg:block">{patient}</div>}
    </header>
  )
}
