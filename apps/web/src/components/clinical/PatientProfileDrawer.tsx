import { SEX_LABELS } from '@adaxai/contracts'
import { Link } from 'react-router'
import { useState } from 'react'
import { PatientThermalCard } from '../../pages/clinical/ThermalPages.tsx'
import { usePatient, usePortalBase } from '../../lib/clinical.ts'
import { fmtDate } from '../../lib/format.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { Badge, ErrorState, LoadingState } from '../ui/Feedback.tsx'
import { DescriptionList } from '../ui/Layout.tsx'
import { PatientAvatar } from '../ui/PatientAvatar.tsx'
import { TabPanel, Tabs } from '../ui/Tabs.tsx'
import { AuscultationCard } from './AuscultationCard.tsx'
import { ClinicalImagesCard } from './ClinicalImagesCard.tsx'
import { PastHistoryPanel } from './PastHistory.tsx'
import { ageSex } from './PatientBanner.tsx'
import { RecordSummary } from './RecordSummary.tsx'

type TabId = 'overview' | 'history' | 'documents'

/**
 * The patient's profile as a side sheet over the consultation, so the doctor
 * can look at the whole picture without leaving the note. Overview: who the
 * patient is and a summary written from the record (not by AI) with what it is
 * based on. Full history: the same past-history panel as in the consultation.
 * Documents: the photographs, stethoscope recordings and thermal studies that
 * belong to the patient.
 */
export function PatientProfileDrawer({ patientId, open, onClose }: { patientId: string; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('overview')
  const patient = usePatient(open ? patientId : undefined)
  const p = patient.data
  return (
    <Dialog open={open} onClose={onClose} title="Patient profile" placement="right" testId="patient-profile-drawer">
      {open && (
        <div className="space-y-4">
          {patient.isPending && <LoadingState rows={3} label="Loading the profile…" />}
          {patient.isError && !p && <ErrorState title="The profile could not be loaded" error={patient.error} onRetry={() => void patient.refetch()} retrying={patient.isFetching} />}
          {p && (
            <>
              <div className="flex items-center gap-3">
                <PatientAvatar name={p.fullName} size="lg" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{p.fullName}</p>
                  <p className="text-sm text-ink-muted">
                    {ageSex(p)} · MRN <span className="font-mono">{p.mrn}</span>
                  </p>
                  {p.dataOrigin === 'synthetic' && <Badge>Synthetic data</Badge>}
                </div>
              </div>
              <Tabs
                label="Patient profile"
                prefix={`profile-${patientId}`}
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'overview', label: 'Overview' },
                  { id: 'history', label: 'Full history' },
                  { id: 'documents', label: 'Documents' },
                ]}
              />
              <TabPanel prefix={`profile-${patientId}`} id="overview" active={tab === 'overview'} className="space-y-5">
                <DescriptionList
                  items={[
                    ['Date of birth', fmtDate(p.dateOfBirth)],
                    ['Sex', SEX_LABELS[p.sex]],
                    ['Phone', p.phone],
                    ['Blood group', p.bloodGroup],
                    ['Preferred language', p.preferredLanguage],
                    ['Emergency contact', [p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(' · ') || null],
                    ['Last visit', p.lastVisitDate ? fmtDate(p.lastVisitDate) : null],
                    ['Registered', fmtDate(p.createdAt)],
                  ]}
                />
                <RecordSummary patientId={patientId} />
                <p className="text-sm">
                  <PatientPageLink patientId={patientId} />
                </p>
              </TabPanel>
              <TabPanel prefix={`profile-${patientId}`} id="history" active={tab === 'history'}>
                <PastHistoryPanel idScope="drawer" patientId={patientId} bare />
              </TabPanel>
              <TabPanel prefix={`profile-${patientId}`} id="documents" active={tab === 'documents'} className="space-y-4">
                <ClinicalImagesCard patientId={patientId} />
                <AuscultationCard patientId={patientId} />
                <PatientThermalCard patient={p} />
              </TabPanel>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

function PatientPageLink({ patientId }: { patientId: string }) {
  const base = usePortalBase()
  return (
    <Link to={`${base}/patients/${patientId}`} className="font-medium text-brand-strong hover:underline">
      Open the patient’s page (consents, appointments, portal access)
    </Link>
  )
}
