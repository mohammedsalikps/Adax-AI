import { AUSCULTATION_SITES, type AuscultationRecording, type AuscultationSite } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stethoscope } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api.ts'
import { usePatient } from '../../lib/clinical.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Spinner } from '../ui/Feedback.tsx'
import { SelectField, TextField } from '../ui/Form.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

const key = (patientId: string) => ['patient', patientId, 'auscultations'] as const

/**
 * Stethoscope recordings uploaded as audio files (for example exported from a
 * digital stethoscope's own app). Upload and playback only: no direct device
 * connection and no automated analysis.
 */
export function AuscultationCard({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const patient = usePatient(patientId)
  const q = useQuery({ queryKey: key(patientId), queryFn: () => api<{ recordings: AuscultationRecording[] }>(`/patients/${patientId}/auscultations`), select: (d) => d.recordings })
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [site, setSite] = useState<AuscultationSite>('mitral')
  const [note, setNote] = useState('')
  const consented = !!patient.data?.consents.some((c) => c.type === 'device_monitoring' && c.status === 'granted')
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('site', site)
      if (note) fd.append('note', note)
      if (encounterId) fd.append('encounterId', encounterId)
      fd.append('file', file!, file!.name)
      return api(`/patients/${patientId}/auscultations`, { method: 'POST', body: fd })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(patientId) })
      toast('success', 'Recording saved')
      setOpen(false)
      setFile(null)
      setNote('')
    },
  })
  return (
    <Card
      title="Stethoscope recordings"
      actions={
        <Button size="sm" variant="secondary" icon={<Stethoscope aria-hidden="true" className="size-4" />} disabled={!consented} onClick={() => setOpen(true)}>
          Add recording
        </Button>
      }
    >
      <p className="mb-2 text-xs text-ink-muted">Audio files uploaded by staff. No stethoscope is connected directly and recordings are not analysed.</p>
      {patient.data && !consented && <Alert tone="info" className="mb-2">Record the patient’s consent to device readings before adding recordings.</Alert>}
      {q.isPending && <Spinner />}
      {q.data && !q.data.length && <p className="text-sm text-ink-muted">No recordings.</p>}
      <ul className="space-y-3">
        {q.data?.map((r) => (
          <li key={r.id} className="text-sm" data-testid="auscultation">
            <p className="font-medium">{AUSCULTATION_SITES[r.site]}</p>
            <audio controls preload="none" src={`/api/files/${r.fileId}`} className="w-full" aria-label={`Stethoscope recording, ${AUSCULTATION_SITES[r.site]}, ${fmtDateTime(r.createdAt)}`} />
            <p className="text-xs text-ink-muted">
              {fmtDateTime(r.createdAt)} · {r.createdByName} · {(r.sizeBytes / 1024).toFixed(0)} KB{r.device ? ` · ${r.device.label}` : ''}
              {r.dataOrigin !== 'clinical' ? ' · synthetic data' : ''}
              {r.note ? ` · ${r.note}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Add stethoscope recording"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
                Save recording
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {upload.isError && <Alert tone="error">{errorMessage(upload.error)}</Alert>}
            <label className="block font-medium">
              Audio file (WAV, MP3, M4A, OGG or WebM)
              <input type="file" accept="audio/*" className="mt-1 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <SelectField label="Site" value={site} onChange={(e) => setSite(e.target.value as AuscultationSite)}>
              {Object.entries(AUSCULTATION_SITES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
            <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Dialog>
      )}
    </Card>
  )
}
