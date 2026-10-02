import { type AiStatus, type ClinicalImage, type Encounter, IMAGE_TYPES, type ImageAnalysis, type ImageType, type NoteFields } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Plus, Sparkles, Upload } from 'lucide-react'
import { useState } from 'react'
import { newIdempotencyKey } from '../../lib/ai.ts'
import { api, errorMessage, issuesToErrors } from '../../lib/api.ts'
import { useMe } from '../../lib/auth.tsx'
import { usePatient } from '../../lib/clinical.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { ReviewControls, StatusBadge } from '../ai/ReviewControls.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge, Spinner } from '../ui/Feedback.tsx'
import { SelectField, TextAreaField, TextField } from '../ui/Form.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

const imagesKey = (patientId: string) => ['patient', patientId, 'images'] as const

function UploadDialog({ patientId, encounterId, onClose }: { patientId: string; encounterId?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<'upload' | 'camera'>('upload')
  const [imageType, setImageType] = useState<ImageType>('wound_photo')
  const [bodySite, setBodySite] = useState('')
  const [description, setDescription] = useState('')
  const save = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('imageType', imageType)
      fd.append('source', source)
      if (bodySite) fd.append('bodySite', bodySite)
      if (description) fd.append('description', description)
      if (encounterId) fd.append('encounterId', encounterId)
      fd.append('file', file!, file!.name)
      return api<ClinicalImage>(`/patients/${patientId}/images`, { method: 'POST', body: fd })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: imagesKey(patientId) })
      toast('success', 'Photograph saved')
      onClose()
    },
  })
  const errors = save.isError ? issuesToErrors(save.error) : {}
  const pick = (f: File | undefined, s: 'upload' | 'camera') => {
    if (!f) return
    setFile(f)
    setSource(s)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add clinical photograph"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file} loading={save.isPending} onClick={() => save.mutate()}>
            Save photograph
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink-muted">JPEG, PNG or WebP. DICOM and other medical imaging formats are not supported. The original is kept unchanged; a copy without location or camera data is shown.</p>
        {save.isError && !Object.keys(errors).length && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <div className="flex flex-wrap gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-brand-strong underline underline-offset-2">
            <Upload aria-hidden="true" className="size-4" />
            Choose a file
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0], 'upload')} />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-brand-strong underline underline-offset-2">
            <Camera aria-hidden="true" className="size-4" />
            Take a photo
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0], 'camera')} />
          </label>
        </div>
        {file && (
          <p>
            Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(0)} KB)
          </p>
        )}
        <SelectField label="Type" value={imageType} onChange={(e) => setImageType(e.target.value as ImageType)} error={errors.imageType}>
          {Object.entries(IMAGE_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <TextField label="Body site (optional)" value={bodySite} onChange={(e) => setBodySite(e.target.value)} error={errors.bodySite} />
        <TextAreaField label="Description (optional)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      </div>
    </Dialog>
  )
}

function AnalysisView({ a, image, patientId, canInsert, append }: { a: ImageAnalysis; image: ClinicalImage; patientId: string; canInsert: boolean; append?: (section: keyof NoteFields, text: string) => void }) {
  const qc = useQueryClient()
  const [added, setAdded] = useState(false)
  const r = a.result
  const done = a.status === 'accepted' || a.status === 'edited'
  return (
    <div className="mt-2 rounded-md border border-ai/30 bg-ai-soft p-3 text-sm" data-testid="image-analysis">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone="ai" icon={<Sparkles aria-hidden="true" className="size-3" />}>
          AI-generated · unverified
        </Badge>
        <StatusBadge status={a.status} />
        <span className="text-xs text-ink-muted">
          {a.producedBy.model} · prompt {a.producedBy.version} · {fmtDateTime(a.createdAt)}
        </span>
      </div>
      <p className={a.status === 'rejected' ? 'line-through' : ''}>{a.finalText ?? r.summary}</p>
      <p className="mt-1 text-xs">
        Image quality: <strong>{r.quality}</strong> ({r.qualityReason})
      </p>
      {r.observations.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {r.observations.map((o, i) => (
            <li key={i}>
              {o.text} <span className="text-ink-muted">({o.location}; confidence {o.confidence})</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-ink-muted">Limitations: {r.limitations.join('; ') || 'none stated'}. A description of visible features only; not a diagnosis.</p>
      <ReviewControls
        encounterId={image.encounterId ?? ''}
        type="image_analysis"
        id={a.id}
        text={r.summary}
        status={a.status}
        confirm={r.quality === 'inadequate' ? 'inadequate' : null}
        onDecided={() => void qc.invalidateQueries({ queryKey: imagesKey(patientId) })}
      />
      {done && canInsert && append && !added && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => {
            append('examination', `Photograph (${IMAGE_TYPES[image.imageType]}${image.bodySite ? `, ${image.bodySite}` : ''}): ${a.finalText ?? r.summary}`)
            setAdded(true)
          }}
        >
          Add to Examination
        </Button>
      )}
    </div>
  )
}

/**
 * Clinical photographs for a patient (and, on the consultation page, linked
 * to the consultation). AI description is optional, doctor-only, needs its
 * own consent and stays unverified until reviewed.
 */
export function ClinicalImagesCard({ patientId, encounter, append }: { patientId: string; encounter?: Encounter; append?: (section: keyof NoteFields, text: string) => void }) {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const patient = usePatient(patientId)
  const isDoctor = me?.role === 'doctor'
  const q = useQuery({ queryKey: imagesKey(patientId), queryFn: () => api<{ images: ClinicalImage[] }>(`/patients/${patientId}/images`), select: (d) => d.images })
  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: () => api<AiStatus>('/ai/status'), enabled: isDoctor })
  const [uploading, setUploading] = useState(false)
  const analyze = useMutation({
    mutationFn: (imageId: string) => api(`/images/${imageId}/analyze`, { method: 'POST', body: { idempotencyKey: newIdempotencyKey() } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: imagesKey(patientId) }),
  })
  const granted = (type: string) => !!patient.data?.consents.some((c) => c.type === type && c.status === 'granted')
  const photoConsent = granted('clinical_photography')
  const aiConsent = granted('ai_image_analysis')
  const vision = status.data?.vision
  const canInsert = !!encounter && encounter.status === 'in_progress' && encounter.canEdit
  return (
    <Card
      title="Clinical photographs"
      actions={
        <Button size="sm" variant="secondary" icon={<Camera aria-hidden="true" className="size-4" />} disabled={!photoConsent} onClick={() => setUploading(true)}>
          Add photograph
        </Button>
      }
    >
      {patient.data && !photoConsent && <Alert tone="info" className="mb-3">Record the patient’s consent to clinical photographs (on their record) before adding one.</Alert>}
      {isDoctor && vision && !vision.available && <p className="mb-2 text-xs text-ink-muted">AI image analysis unavailable: {vision.reason}</p>}
      {analyze.isError && <Alert tone="error" className="mb-2">{errorMessage(analyze.error)}</Alert>}
      {q.isPending && <Spinner />}
      {q.data && !q.data.length && <p className="text-sm text-ink-muted">No photographs.</p>}
      <ul className="space-y-4">
        {q.data?.map((img) => {
          const current = img.analyses.find((a) => a.status !== 'superseded')
          return (
            <li key={img.id} className="rounded-lg border border-line p-3" data-testid="clinical-image">
              <div className="flex flex-wrap gap-3">
                <a href={`/api/files/${img.previewFileId}`} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={`/api/files/${img.previewFileId}`} alt={`${IMAGE_TYPES[img.imageType]}${img.bodySite ? `, ${img.bodySite}` : ''}, taken ${fmtDateTime(img.createdAt)}`} className="h-28 w-36 rounded-md bg-canvas object-contain" loading="lazy" />
                </a>
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="font-medium">
                    {IMAGE_TYPES[img.imageType]}
                    {img.bodySite ? ` · ${img.bodySite}` : ''}
                  </p>
                  {img.description && <p>{img.description}</p>}
                  <p className="text-xs text-ink-muted">
                    {fmtDateTime(img.createdAt)} · {img.createdByName} · {img.metadata.format} {img.width}×{img.height} · {img.source === 'camera' ? 'camera' : 'uploaded'}
                    {img.metadata.hadGps ? ' · location data removed from the displayed copy' : ''}
                    {img.dataOrigin !== 'clinical' ? ' · synthetic data' : ''}
                  </p>
                  {isDoctor && vision?.available && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Sparkles aria-hidden="true" className="size-4" />}
                      disabled={!aiConsent}
                      title={aiConsent ? undefined : 'Record consent to AI description of photographs first'}
                      loading={analyze.isPending && analyze.variables === img.id}
                      onClick={() => analyze.mutate(img.id)}
                    >
                      {current ? 'Describe again with AI' : 'Describe with AI'}
                    </Button>
                  )}
                  {isDoctor && vision?.available && !aiConsent && <p className="text-xs text-ink-muted">AI description needs the patient’s consent to AI description of photographs.</p>}
                </div>
              </div>
              {current && <AnalysisView a={current} image={img} patientId={patientId} canInsert={canInsert} append={append} />}
            </li>
          )
        })}
      </ul>
      {uploading && <UploadDialog patientId={patientId} encounterId={encounter?.id} onClose={() => setUploading(false)} />}
    </Card>
  )
}
