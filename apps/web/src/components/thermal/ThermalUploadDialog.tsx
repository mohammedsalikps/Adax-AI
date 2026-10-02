import { CaptureProtocol, THERMAL_VIEWS, type ThermalCapture } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, errorMessage, issuesToErrors } from '../../lib/api.ts'
import { usePortalBase } from '../../lib/clinical.ts'
import { thermalKey } from '../../lib/thermal.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert } from '../ui/Feedback.tsx'
import { SelectField, TextAreaField, TextField } from '../ui/Form.tsx'

const num = (s: string) => (s.trim() === '' ? null : Number(s))

/** Upload a FLIR radiometric JPEG with the conditions it was taken under. */
export function ThermalUploadDialog({ patientId, encounterId, onClose }: { patientId: string; encounterId?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const base = usePortalBase()
  const [file, setFile] = useState<File | null>(null)
  const [v, setV] = useState({ bodyRegion: '', view: 'anterior', roomTempC: '', acclimatisationMin: '', distanceM: '', notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const upload = useMutation({
    mutationFn: (fd: FormData) => api<ThermalCapture>(`/patients/${patientId}/thermal`, { method: 'POST', body: fd }),
    onSuccess: (c) => {
      qc.setQueryData(thermalKey(c.id), c)
      void qc.invalidateQueries({ queryKey: ['patient', patientId, 'thermal'] })
      onClose()
      navigate(`${base}/thermal/${c.id}`)
    },
    onError: (e) => setErrors(Object.fromEntries(Object.entries(issuesToErrors(e)).map(([k, m]) => [k.replace(/^protocol\./, ''), m]))),
  })
  const submit = () => {
    const protocol = { bodyRegion: v.bodyRegion, view: v.view, roomTempC: num(v.roomTempC), acclimatisationMin: num(v.acclimatisationMin), distanceM: num(v.distanceM), notes: v.notes }
    const r = CaptureProtocol.safeParse(protocol)
    const next: Record<string, string> = r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]))
    if (!file) next.file = 'Choose the radiometric JPEG from the camera'
    setErrors(next)
    if (Object.keys(next).length || !file) return
    const fd = new FormData()
    fd.append('protocol', JSON.stringify(protocol))
    if (encounterId) fd.append('encounterId', encounterId)
    fd.append('file', file)
    upload.mutate(fd)
  }
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Upload thermal image"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={upload.isPending} onClick={submit}>
            Upload and extract
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <p className="text-sm text-ink-muted sm:col-span-2">Upload the original radiometric JPEG exported from a FLIR camera. Screenshots or edited images have no temperature data and are rejected.</p>
        {upload.isError && !Object.keys(errors).length && <Alert tone="error" className="sm:col-span-2">{errorMessage(upload.error)}</Alert>}
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="thermal-file" className="block text-sm font-medium">
            Radiometric JPEG <span className="text-down" aria-hidden="true">*</span>
          </label>
          <input id="thermal-file" type="file" accept="image/jpeg,.jpg,.jpeg" aria-invalid={!!errors.file} aria-describedby={errors.file ? 'thermal-file-err' : undefined} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
          {errors.file && (
            <p id="thermal-file-err" className="text-xs font-medium text-down">
              {errors.file}
            </p>
          )}
        </div>
        <TextField label="Body region" required value={v.bodyRegion} onChange={(e) => setV({ ...v, bodyRegion: e.target.value })} error={errors.bodyRegion} placeholder="e.g. Both knees" />
        <SelectField label="View" value={v.view} onChange={(e) => setV({ ...v, view: e.target.value })}>
          {THERMAL_VIEWS.map((x) => (
            <option key={x} value={x}>
              {x.replace('_', ' ')}
            </option>
          ))}
        </SelectField>
        <TextField label="Room temperature (°C)" inputMode="decimal" value={v.roomTempC} onChange={(e) => setV({ ...v, roomTempC: e.target.value })} error={errors.roomTempC} />
        <TextField label="Acclimatisation (minutes)" inputMode="numeric" value={v.acclimatisationMin} onChange={(e) => setV({ ...v, acclimatisationMin: e.target.value })} error={errors.acclimatisationMin} hint="Time the skin was exposed to room air before capture." />
        <TextField label="Camera distance (m)" inputMode="decimal" value={v.distanceM} onChange={(e) => setV({ ...v, distanceM: e.target.value })} error={errors.distanceM} />
        <TextAreaField label="Notes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} className="sm:col-span-2" />
      </div>
    </Dialog>
  )
}
