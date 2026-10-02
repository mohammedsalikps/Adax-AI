import { flagVital, VITALS, type VitalKind } from '@adaxai/contracts'
import { findPhrase } from '../ai/safety.ts'
import type { RoutingRules } from '../settings/schema.ts'

export interface RoutingInput {
  ageYears: number
  reasonForVisit: string
  phone: string
  currentPriority: 'normal' | 'urgent'
  /** Latest value per kind measured at this visit. */
  vitals: { kind: VitalKind; value: number }[]
  departments: { id: string; code: string; name: string }[]
  /** Active doctors with today's open visits assigned to them. */
  doctors: { id: string; fullName: string; departmentId: string | null; load: number }[]
}

export interface RoutingOutput {
  departmentId: string | null
  departmentCode: string
  departmentName: string | null
  priority: 'normal' | 'urgent'
  doctorId: string | null
  doctorName: string | null
  missingIntake: string[]
  redFlags: { id: string; source: 'reason' | 'vitals'; matched: string; instruction: string }[]
  reasons: { rule: string; text: string }[]
}

/**
 * Pure, deterministic routing: same rules and input, same suggestion. Every
 * part of the suggestion carries the rule that produced it.
 */
export function suggestRouting(rules: RoutingRules, input: RoutingInput): RoutingOutput {
  const reasons: RoutingOutput['reasons'] = []
  const complaint = input.reasonForVisit.trim()

  const rule = rules.departments.find((r) => {
    const w = r.when
    if (w.ageBelow !== undefined && !(input.ageYears < w.ageBelow)) return false
    if (w.ageAtLeast !== undefined && !(input.ageYears >= w.ageAtLeast)) return false
    if (w.complaintAny && !w.complaintAny.some((p) => findPhrase(complaint, p))) return false
    return true
  })!
  const dept = input.departments.find((d) => d.code === rule.department) ?? null
  reasons.push({ rule: rule.id, text: dept ? `${dept.name}: ${rule.reason}` : `Department ${rule.department} is not available (inactive or missing); choose one manually.` })

  const redFlags: RoutingOutput['redFlags'] = []
  for (const rf of rules.redFlags) {
    const hit = rf.phrases.find((p) => findPhrase(complaint, p))
    if (hit) redFlags.push({ id: rf.id, source: 'reason', matched: `“${hit}” in the reason for visit`, instruction: rf.instruction })
  }
  for (const v of input.vitals) {
    const flag = flagVital(v.kind, v.value, input.ageYears)
    if (flag === 'critical_low' || flag === 'critical_high') {
      const d = VITALS[v.kind]
      redFlags.push({ id: `critical-${v.kind}`, source: 'vitals', matched: `${d.label} ${v.value} ${d.unit} (${flag === 'critical_low' ? 'below' : 'above'} the critical limit)`, instruction: rules.criticalVitalsInstruction })
    }
  }

  let priority = input.currentPriority
  if (redFlags.length && rules.urgentWhenRedFlag) {
    priority = 'urgent'
    reasons.push({ rule: 'urgentWhenRedFlag', text: 'Urgent for staff review because a red flag is present.' })
  } else reasons.push({ rule: 'priority', text: `No red flag; priority unchanged (${input.currentPriority}).` })

  const missingIntake: string[] = []
  if (rules.requiredIntake.reasonForVisit && !complaint) missingIntake.push('Reason for visit')
  for (const k of rules.requiredIntake.vitals) if (!input.vitals.some((v) => v.kind === k)) missingIntake.push(VITALS[k].label)
  if (rules.requiredIntake.phone && !input.phone.trim()) missingIntake.push('Phone number')

  let doctor: RoutingInput['doctors'][number] | null = null
  if (rules.clinician === 'least-busy' && dept) {
    doctor = input.doctors.filter((d) => d.departmentId === dept.id).sort((a, b) => a.load - b.load || a.fullName.localeCompare(b.fullName))[0] ?? null
    reasons.push({ rule: 'clinician', text: doctor ? `${doctor.fullName} has the fewest open visits today in ${dept.name} (${doctor.load}).` : `No active doctor in ${dept.name}; any doctor may see the patient.` })
  }

  return { departmentId: dept?.id ?? null, departmentCode: rule.department, departmentName: dept?.name ?? null, priority, doctorId: doctor?.id ?? null, doctorName: doctor?.fullName ?? null, missingIntake, redFlags, reasons }
}
