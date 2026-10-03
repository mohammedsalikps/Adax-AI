import type { Application } from '@adaxai/contracts'
import { HeartPulse, type LucideIcon, ShieldCheck, Stethoscope } from 'lucide-react'

/**
 * How each application looks at its front door: an icon, a tinted tile and an
 * accent line. All three come from the design tokens (blue for clinical work,
 * green for the patient's own space, ink for administration), so they are
 * recognisably different without a second colour scheme.
 */
export const APP_STYLE: Record<Application, { Icon: LucideIcon; tile: string; accent: string; badge: string }> = {
  doctor: { Icon: Stethoscope, tile: 'bg-brand-soft text-brand', accent: 'bg-brand', badge: 'border-brand/20 bg-brand-soft text-brand-strong' },
  patient: { Icon: HeartPulse, tile: 'bg-ok-soft text-ok', accent: 'bg-ok', badge: 'border-ok/20 bg-ok-soft text-ok' },
  admin: { Icon: ShieldCheck, tile: 'bg-canvas text-ink', accent: 'bg-ink', badge: 'border-line-strong bg-canvas text-ink' },
}
