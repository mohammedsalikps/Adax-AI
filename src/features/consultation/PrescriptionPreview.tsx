import { formatDate, formatPhone, toIsoDateString } from '@/lib/format'
import { DEMO_DOCTOR } from '@/mock/doctor'
import type {
  ConsultationDiagnosis,
  ConsultationPrescriptionItem,
} from '@/types/consultation'
import type { Patient, Sex } from '@/types/patient'
import { APP_NAME } from '@/lib/brand'

const SEX_LABEL: Record<Sex, string> = { male: 'Male', female: 'Female', other: 'Other' }

const FREQUENCY_TEXT: Record<string, string> = {
  OD: 'Once daily',
  BD: 'Twice daily',
  TDS: 'Three times daily',
  QID: 'Four times daily',
  HS: 'At bedtime',
  SOS: 'As needed',
}

export interface PrescriptionPreviewProps {
  patient: Patient
  age: number
  diagnoses: ConsultationDiagnosis[]
  items: ConsultationPrescriptionItem[]
  clinicalNotes: string
  followUpRequired: boolean
  followUpDate: string
  followUpInstructions: string
}

/**
 * The printable prescription document. Presentational only — it renders
 * exactly what the doctor entered and adds nothing of its own.
 *
 * This is a demonstration document, not a legally valid prescription.
 */
export function PrescriptionPreview({
  patient,
  age,
  diagnoses,
  items,
  clinicalNotes,
  followUpRequired,
  followUpDate,
  followUpInstructions,
}: PrescriptionPreviewProps) {
  const issuedOn = formatDate(toIsoDateString())

  return (
    <article className="prescription-sheet mx-auto w-full max-w-[820px] bg-surface p-8 text-ink">
      <p className="mb-4 rounded-control border border-caution/40 bg-caution-soft px-3 py-2 text-[12px] font-semibold text-caution">
        Draft prescription — review before printing. Demonstration document, not a
        valid prescription.
      </p>

      {/* -------------------------------------------------- clinic header */}
      <header className="avoid-break flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight">{DEMO_DOCTOR.clinicName}</h1>
          <p className="text-[12px] text-ink-soft">{DEMO_DOCTOR.clinicAddress}</p>
          <p className="tnum text-[12px] text-ink-soft">
            Tel {formatPhone(DEMO_DOCTOR.clinicPhone)}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-sm font-bold">{DEMO_DOCTOR.fullName}</p>
          <p className="text-[12px] text-ink-soft">{DEMO_DOCTOR.qualifications}</p>
          <p className="text-[12px] text-ink-soft">{DEMO_DOCTOR.specialty}</p>
          <p className="tnum text-[12px] text-ink-soft">
            Reg. No. {DEMO_DOCTOR.registrationNumber}
          </p>
        </div>
      </header>

      {/* ------------------------------------------------- patient block */}
      <section className="avoid-break grid grid-cols-2 gap-x-6 gap-y-1 border-b border-line py-3 text-[12px] sm:grid-cols-3">
        <Field label="Patient" value={patient.fullName} strong />
        <Field label="Patient ID" value={patient.id} numeric />
        <Field label="Date" value={issuedOn} numeric />
        <Field label="Age / Gender" value={`${age} years · ${SEX_LABEL[patient.sex]}`} numeric />
        <Field label="Blood group" value={patient.bloodGroup ?? 'Not known'} />
        <Field
          label="Phone"
          value={formatPhone(patient.contact.phone)}
          numeric
        />
      </section>

      {/* ----------------------------------------------------- allergies */}
      <section className="avoid-break border-b border-line py-2.5">
        <p className="text-[10px] font-bold tracking-wider uppercase">Allergies</p>
        {patient.allergies.length === 0 ? (
          <p className="text-[12px]">No known allergies recorded.</p>
        ) : (
          <p className="text-[12px] font-semibold text-critical">
            {patient.allergies
              .map((allergy) => `${allergy.substance} (${allergy.severity} — ${allergy.reaction})`)
              .join('; ')}
          </p>
        )}
      </section>

      {/* ----------------------------------------------------- diagnoses */}
      <section className="avoid-break border-b border-line py-2.5">
        <p className="text-[10px] font-bold tracking-wider uppercase">Diagnosis</p>
        {diagnoses.length === 0 ? (
          <p className="text-[12px] text-ink-muted">Not recorded.</p>
        ) : (
          <ol className="mt-0.5 list-inside list-decimal text-[12px]">
            {diagnoses.map((diagnosis) => (
              <li key={diagnosis.id}>
                <span className="font-semibold">{diagnosis.name}</span>
                {diagnosis.notes && <span className="text-ink-soft"> — {diagnosis.notes}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ------------------------------------------------------ rx table */}
      <section className="py-3">
        <p className="mb-1.5 font-serif text-xl leading-none font-bold" aria-hidden>
          ℞
        </p>
        <span className="sr-only">Prescribed medication</span>

        {items.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No medication prescribed at this visit.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr>
                  <Th className="w-6">#</Th>
                  <Th>Medication</Th>
                  <Th>Dose</Th>
                  <Th>Frequency</Th>
                  <Th>Route</Th>
                  <Th>Duration</Th>
                  <Th>Quantity</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className="avoid-break align-top">
                    <Td className="tnum">{index + 1}</Td>
                    <Td>
                      <span className="font-semibold">{item.medication}</span>
                      {item.strength && <span className="tnum"> {item.strength}</span>}
                      {item.genericName && (
                        <span className="block text-[11px] text-ink-soft">
                          {item.genericName}
                        </span>
                      )}
                      {item.instructions && (
                        <span className="block text-[11px] text-ink-soft">
                          {item.instructions}
                        </span>
                      )}
                    </Td>
                    <Td className="tnum">{item.dose}</Td>
                    <Td>
                      {FREQUENCY_TEXT[item.frequency] ?? item.frequency}
                      <span className="block text-[11px] text-ink-soft">{item.frequency}</span>
                    </Td>
                    <Td className="capitalize">{item.route}</Td>
                    <Td className="tnum">{item.duration}</Td>
                    <Td className="tnum">{item.quantity || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- instructions */}
      {clinicalNotes.trim() && (
        <section className="avoid-break border-t border-line py-2.5">
          <p className="text-[10px] font-bold tracking-wider uppercase">Instructions</p>
          <p className="text-[12px] whitespace-pre-wrap">{clinicalNotes}</p>
        </section>
      )}

      {/* ------------------------------------------------------- follow-up */}
      <section className="avoid-break border-t border-line py-2.5">
        <p className="text-[10px] font-bold tracking-wider uppercase">Follow-up</p>
        {followUpRequired ? (
          <p className="text-[12px]">
            <span className="tnum font-semibold">
              {followUpDate ? formatDate(followUpDate) : 'Date not set'}
            </span>
            {followUpInstructions && <span> — {followUpInstructions}</span>}
          </p>
        ) : (
          <p className="text-[12px]">No follow-up required.</p>
        )}
      </section>

      {/* ------------------------------------------------------- signature */}
      <footer className="avoid-break mt-8 flex items-end justify-between gap-6">
        <p className="prescription-footer max-w-[60%] text-[10px] text-ink-muted">
          Generated by {APP_NAME}, a demonstration application. This document is not
          a valid prescription and must not be used to dispense medication.
        </p>
        <div className="text-center">
          <div className="h-10 w-52 border-b border-ink" />
          <p className="mt-1 text-[11px] font-semibold">{DEMO_DOCTOR.fullName}</p>
          <p className="tnum text-[10px] text-ink-soft">
            Reg. No. {DEMO_DOCTOR.registrationNumber}
          </p>
          <p className="text-[10px] text-ink-muted">Signature</p>
        </div>
      </footer>
    </article>
  )
}

function Field({
  label,
  value,
  strong = false,
  numeric = false,
}: {
  label: string
  value: string
  strong?: boolean
  numeric?: boolean
}) {
  return (
    <p className="min-w-0">
      <span className="text-ink-muted">{label}: </span>
      <span
        className={`${strong ? 'font-bold' : 'font-medium'} ${numeric ? 'tnum' : ''}`}
      >
        {value}
      </span>
    </p>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`border-b border-ink px-1.5 py-1 text-[10px] font-bold tracking-wide uppercase ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`border-b border-line px-1.5 py-1.5 ${className}`}>{children}</td>
}
