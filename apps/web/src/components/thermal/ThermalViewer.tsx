import { DATA_ORIGIN_LABELS, type ThermalCapture, type ThermalReviewRequest, type ThermalRoiInput } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Circle, Plus, Save, Square, Trash2 } from 'lucide-react'
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api.ts'
import { useMe } from '../../lib/auth.tsx'
import { fmtDateTime } from '../../lib/format.ts'
import { fmtC, type PaletteName, paletteCss, paletteLut, type RoiGeom, roiPreviewStats, thermalKey, useMatrix } from '../../lib/thermal.ts'
import { Button } from '../ui/Button.tsx'
import { Alert, Badge, Spinner } from '../ui/Feedback.tsx'
import { SelectField, TextAreaField, TextField } from '../ui/Form.tsx'
import { Card, DescriptionList } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'
import { ThermalFlagsCard, useThermalFlags } from './ThermalFlags.tsx'
import { ThermalLabelsCard } from './ThermalLabels.tsx'

interface EditableRoi extends RoiGeom {
  key: string
  label: string
  pairWith: string
}

const round = (v: number) => Math.round(v * 10) / 10
const NO_HOTSPOTS: { x: number; y: number; width: number; height: number }[] = []
const fromCapture = (c: ThermalCapture): EditableRoi[] => c.rois.map((r) => ({ key: r.id, label: r.label, shape: r.shape, x: r.x, y: r.y, width: r.width, height: r.height, pairWith: r.pairWith ?? '' }))

function ThermalCanvas({
  matrix,
  c,
  low,
  high,
  palette,
  rois,
  tool,
  onDrawn,
  hotspots = NO_HOTSPOTS,
}: {
  matrix: Float32Array
  c: ThermalCapture
  low: number
  high: number
  palette: PaletteName
  rois: EditableRoi[]
  tool: 'none' | 'rect' | 'ellipse'
  onDrawn: (g: RoiGeom) => void
  /** Experimental warm areas, outlined dashed in amber. */
  hotspots?: { x: number; y: number; width: number; height: number }[]
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; t: number } | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // The ref is the source of truth while dragging: pointer events can arrive
  // before React re-renders, so handlers must not rely on the `drag` state.
  const dragRef = useRef<{ x0: number; y0: number } | null>(null)
  const { width: w, height: h } = c

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const lut = paletteLut(palette)
    const img = ctx.createImageData(w, h)
    const span = Math.max(high - low, 0.01)
    for (let i = 0; i < w * h; i++) {
      const v = matrix[i]!
      const idx = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(((v - low) / span) * 255))) : 0
      img.data[i * 4] = lut[idx * 3]!
      img.data[i * 4 + 1] = lut[idx * 3 + 1]!
      img.data[i * 4 + 2] = lut[idx * 3 + 2]!
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [matrix, w, h, low, high, palette])

  // Overlay drawn at a higher resolution so outlines and labels stay crisp.
  const SCALE = Math.max(1, Math.ceil(640 / w))
  useEffect(() => {
    const ctx = overlay.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w * SCALE, h * SCALE)
    const draw = (g: RoiGeom, label: string, pending = false) => {
      ctx.save()
      ctx.lineWidth = 2
      ctx.setLineDash(pending ? [6, 4] : [])
      ctx.strokeStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 3
      ctx.beginPath()
      if (g.shape === 'rect') ctx.rect(g.x * SCALE, g.y * SCALE, g.width * SCALE, g.height * SCALE)
      else ctx.ellipse((g.x + g.width / 2) * SCALE, (g.y + g.height / 2) * SCALE, (g.width / 2) * SCALE, (g.height / 2) * SCALE, 0, 0, Math.PI * 2)
      ctx.stroke()
      if (label) {
        ctx.font = `${Math.max(12, SCALE * 4)}px system-ui, sans-serif`
        ctx.fillStyle = '#ffffff'
        ctx.fillText(label, g.x * SCALE + 4, g.y * SCALE + Math.max(14, SCALE * 5))
      }
      ctx.restore()
    }
    hotspots.forEach((hs, i) => {
      ctx.save()
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#fbbf24'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 3
      ctx.strokeRect(hs.x * SCALE, hs.y * SCALE, hs.width * SCALE, hs.height * SCALE)
      ctx.font = `${Math.max(12, SCALE * 4)}px system-ui, sans-serif`
      ctx.fillStyle = '#fbbf24'
      ctx.fillText(`H${i + 1}`, hs.x * SCALE + 2, Math.max(12, hs.y * SCALE - 4))
      ctx.restore()
    })
    rois.forEach((r) => draw(r, r.label))
    if (drag && tool !== 'none') draw({ shape: tool, x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }, '', true)
  }, [rois, drag, tool, w, h, SCALE, hotspots])

  const toPixel = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(w, ((e.clientX - r.left) / r.width) * w)), y: Math.max(0, Math.min(h, ((e.clientY - r.top) / r.height) * h)) }
  }

  return (
    <div className="space-y-2">
      {/* Width is capped so that the height never exceeds 70vh while keeping the image's aspect ratio. */}
      <div className="relative mx-auto overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(70vh * ${w / h}))` }}>
        <canvas ref={canvas} width={w} height={h} className="absolute inset-0 size-full" style={{ imageRendering: 'pixelated' }} role="img" aria-label={`Thermal image ${w} by ${h} pixels, ${fmtC(c.minC)} to ${fmtC(c.maxC)}`} />
        <canvas
          ref={overlay}
          width={w * SCALE}
          height={h * SCALE}
          data-testid="thermal-overlay"
          className={`absolute inset-0 size-full touch-none ${tool !== 'none' ? 'cursor-crosshair' : 'cursor-default'}`}
          aria-hidden="true"
          onPointerMove={(e) => {
            const p = toPixel(e)
            const xi = Math.min(w - 1, Math.floor(p.x))
            const yi = Math.min(h - 1, Math.floor(p.y))
            setHover({ x: xi, y: yi, t: matrix[yi * w + xi]! })
            const start = dragRef.current
            if (start) setDrag({ ...start, x1: p.x, y1: p.y })
          }}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => {
            if (tool === 'none') return
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = toPixel(e)
            dragRef.current = { x0: p.x, y0: p.y }
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
          onPointerUp={(e) => {
            const start = dragRef.current
            dragRef.current = null
            setDrag(null)
            if (!start || tool === 'none') return
            // The end point comes from this event, not from possibly stale state.
            const end = toPixel(e)
            const g = { shape: tool, x: round(Math.min(start.x0, end.x)), y: round(Math.min(start.y0, end.y)), width: round(Math.abs(end.x - start.x0)), height: round(Math.abs(end.y - start.y0)) }
            if (g.width >= 1 && g.height >= 1) onDrawn(g)
          }}
          onPointerCancel={() => {
            dragRef.current = null
            setDrag(null)
          }}
        />
      </div>
      <p className="min-h-5 text-sm tabular-nums" aria-live="polite" data-testid="hover-readout">
        {hover ? `x ${hover.x}, y ${hover.y}: ${fmtC(hover.t, 2)}` : 'Point at the image to read a temperature.'}
      </p>
    </div>
  )
}

function ReviewPanel({ c, onDone }: { c: ThermalCapture; onDone: (c: ThermalCapture) => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const review = useMutation({
    mutationFn: (body: ThermalReviewRequest) => api<ThermalCapture>(`/thermal/${c.id}/review`, { method: 'POST', body }),
    onSuccess: (d) => (onDone(d), toast('success', d.status === 'approved' ? 'Measurements approved' : 'Image rejected')),
  })
  return (
    <Card title="Doctor review">
      <div className="space-y-3 text-sm">
        <p>Approving records that the image and regions are fit to keep with the patient’s record. It is not a diagnosis, and the image cannot be changed afterwards.</p>
        {review.isError && <Alert tone="error">{errorMessage(review.error)}</Alert>}
        <TextAreaField label="Note" hint="Required when rejecting." rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button loading={review.isPending && review.variables?.decision === 'approved'} onClick={() => review.mutate({ decision: 'approved', note })}>
            Approve measurements
          </Button>
          <Button variant="secondary" disabled={!note.trim()} loading={review.isPending && review.variables?.decision === 'rejected'} onClick={() => review.mutate({ decision: 'rejected', note })}>
            Reject
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Thermal measurement workspace for one capture. */
export function ThermalViewer({ capture }: { capture: ThermalCapture }) {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const toast = useToast()
  const matrix = useMatrix(capture)
  const [palette, setPalette] = useState<PaletteName>('iron')
  const [low, setLow] = useState(capture.minC)
  const [high, setHigh] = useState(capture.maxC)
  const [tool, setTool] = useState<'none' | 'rect' | 'ellipse'>('none')
  const [rois, setRois] = useState<EditableRoi[]>(() => fromCapture(capture))
  const [dirty, setDirty] = useState(false)
  const editable = capture.status === 'draft'
  const [showFlags, setShowFlags] = useState(false)
  const flags = useThermalFlags(capture, showFlags)
  const setAll = (next: EditableRoi[]) => (setRois(next), setDirty(true))

  const save = useMutation({
    mutationFn: () =>
      api<ThermalCapture>(`/thermal/${capture.id}/rois`, {
        method: 'PUT',
        body: { rois: rois.map(({ label, shape, x, y, width, height, pairWith }) => ({ label, shape, x, y, width, height, pairWith: pairWith || null })) satisfies ThermalRoiInput[] },
      }),
    onSuccess: (d) => {
      qc.setQueryData(thermalKey(d.id), d)
      setRois(fromCapture(d))
      setDirty(false)
      toast('success', 'Regions saved; statistics computed')
    },
  })

  const serverStats = useMemo(() => new Map(capture.rois.map((r) => [r.label.toLowerCase(), r.stats])), [capture.rois])
  const addRoi = (g: RoiGeom) => {
    let n = rois.length + 1
    while (rois.some((r) => r.label === `Region ${n}`)) n++
    setAll([...rois, { ...g, key: crypto.randomUUID(), label: `Region ${n}`, pairWith: '' }])
    setTool('none')
  }

  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Measurements only">
        Temperatures come from the camera’s radiometric data and depend on emissivity, distance and room conditions. They are not a diagnosis and this tool is not clinically validated. It has been tested with public FLIR sample files only.
      </Alert>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card title="Thermal image">
          {matrix.isPending && <Spinner label="Loading temperature data…" />}
          {matrix.isError && <Alert tone="error">{errorMessage(matrix.error)}</Alert>}
          {matrix.data && (
            <div className="space-y-4">
              <ThermalCanvas matrix={matrix.data} c={capture} low={low} high={high} palette={palette} rois={rois} tool={editable ? tool : 'none'} onDrawn={addRoi} hotspots={showFlags ? flags.data?.hotspots : undefined} />
              <div className="space-y-1">
                <div className="h-3 rounded" style={{ background: paletteCss(palette) }} aria-hidden="true" />
                <div className="flex justify-between text-xs tabular-nums text-ink-muted">
                  <span>{fmtC(low)}</span>
                  <span>{fmtC((low + high) / 2)}</span>
                  <span>{fmtC(high)}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <SelectField label="Palette" value={palette} onChange={(e) => setPalette(e.target.value as PaletteName)}>
                  <option value="iron">Iron</option>
                  <option value="rainbow">Rainbow</option>
                  <option value="grayscale">Greyscale</option>
                </SelectField>
                <TextField label="Span low (°C)" type="number" step="0.1" value={low} onChange={(e) => setLow(Number(e.target.value))} />
                <TextField label="Span high (°C)" type="number" step="0.1" value={high} onChange={(e) => setHigh(Number(e.target.value))} />
                <div className="flex items-end">
                  <Button variant="secondary" onClick={() => (setLow(capture.minC), setHigh(capture.maxC))}>
                    Auto span
                  </Button>
                </div>
              </div>
              {editable && (
                <div role="group" aria-label="Drawing tool" className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Draw a region:</span>
                  <Button size="sm" variant={tool === 'rect' ? 'primary' : 'secondary'} aria-pressed={tool === 'rect'} icon={<Square aria-hidden="true" className="size-4" />} onClick={() => setTool(tool === 'rect' ? 'none' : 'rect')}>
                    Rectangle
                  </Button>
                  <Button size="sm" variant={tool === 'ellipse' ? 'primary' : 'secondary'} aria-pressed={tool === 'ellipse'} icon={<Circle aria-hidden="true" className="size-4" />} onClick={() => setTool(tool === 'ellipse' ? 'none' : 'ellipse')}>
                    Ellipse
                  </Button>
                  {tool !== 'none' && <span className="text-sm text-ink-muted">Drag on the image.</span>}
                </div>
              )}
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Capture">
            <DescriptionList
              items={[
                ['Status', capture.status === 'draft' ? <Badge tone="warn">Draft — awaiting review</Badge> : capture.status === 'approved' ? <Badge tone="ok">Approved</Badge> : <Badge>Rejected</Badge>],
                ['Body region', `${capture.protocol.bodyRegion} · ${capture.protocol.view.replace('_', ' ')}`],
                ['Image range', `${fmtC(capture.minC)} – ${fmtC(capture.maxC)} (mean ${fmtC(capture.meanC)})`],
                ['Resolution', `${capture.width} × ${capture.height}`],
                ['Room / acclimatisation', `${capture.protocol.roomTempC ?? '—'} °C · ${capture.protocol.acclimatisationMin ?? '—'} min`],
                ['Distance', capture.protocol.distanceM ? `${capture.protocol.distanceM} m` : '—'],
                ['Emissivity (camera)', capture.parameters.emissivity?.toFixed(2) ?? '—'],
                ['Reflected temp (camera)', fmtC(capture.parameters.reflectedTempC)],
                ['Camera', [capture.camera.make, capture.camera.model].filter(Boolean).join(' ') || '—'],
                ['Extractor', `${capture.extractor.name} ${capture.extractor.version}`],
                ['Data origin', <Badge tone={capture.dataOrigin === 'clinical' ? 'neutral' : 'notice'}>{DATA_ORIGIN_LABELS[capture.dataOrigin]}</Badge>],
                ['Uploaded', `${fmtDateTime(capture.createdAt)} · ${capture.createdByName ?? ''}`],
                ...(capture.review ? ([['Reviewed', `${fmtDateTime(capture.review.at)} · ${capture.review.byName ?? ''}${capture.review.note ? ` · ${capture.review.note}` : ''}`]] as [string, string][]) : []),
              ]}
            />
            {capture.protocol.notes && <p className="mt-3 text-sm">Notes: {capture.protocol.notes}</p>}
          </Card>
          {capture.visibleFileId && (
            <Card title="Visible-light image">
              <img src={`/api/files/${capture.visibleFileId}`} alt={`Visible-light photo taken with the thermal image of ${capture.protocol.bodyRegion}`} className="w-full rounded-lg" />
            </Card>
          )}
        </div>
      </div>

      <Card
        title="Regions of interest"
        actions={
          editable && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => addRoi({ shape: 'rect', x: round(capture.width / 4), y: round(capture.height / 4), width: round(capture.width / 4), height: round(capture.height / 4) })}>
                Add region
              </Button>
              <Button size="sm" icon={<Save aria-hidden="true" className="size-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                Save regions
              </Button>
            </div>
          )
        }
      >
        {save.isError && <Alert tone="error" className="mb-3">{errorMessage(save.error)}</Alert>}
        {!rois.length && <p className="text-sm text-ink-muted">No regions yet. {editable ? 'Draw on the image or use “Add region”.' : ''}</p>}
        <ul className="space-y-3">
          {rois.map((r, i) => {
            const saved = !dirty ? serverStats.get(r.label.toLowerCase()) : undefined
            const preview = matrix.data ? roiPreviewStats(matrix.data, capture.width, capture.height, r) : null
            const s = saved ?? preview
            const set = (patch: Partial<EditableRoi>) => setAll(rois.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <li key={r.key} className="rounded-lg border border-line p-3" data-testid={`roi-${r.label}`}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem_repeat(4,5.5rem)_10rem_auto] sm:items-end">
                  <TextField label="Label" value={r.label} disabled={!editable} onChange={(e) => set({ label: e.target.value })} />
                  <SelectField label="Shape" value={r.shape} disabled={!editable} onChange={(e) => set({ shape: e.target.value as RoiGeom['shape'] })}>
                    <option value="rect">Rectangle</option>
                    <option value="ellipse">Ellipse</option>
                  </SelectField>
                  {(['x', 'y', 'width', 'height'] as const).map((k) => (
                    <TextField key={k} label={k === 'width' ? 'Width' : k === 'height' ? 'Height' : k.toUpperCase()} type="number" step="1" min={0} value={r[k]} disabled={!editable} onChange={(e) => set({ [k]: Number(e.target.value) })} />
                  ))}
                  <SelectField label="Compare with" value={r.pairWith} disabled={!editable} onChange={(e) => set({ pairWith: e.target.value })}>
                    <option value="">—</option>
                    {rois.filter((o) => o.key !== r.key).map((o) => (
                      <option key={o.key} value={o.label}>
                        {o.label}
                      </option>
                    ))}
                  </SelectField>
                  {editable && <Button variant="ghost" aria-label={`Remove ${r.label}`} icon={<Trash2 aria-hidden="true" className="size-4" />} onClick={() => setAll(rois.filter((_, j) => j !== i))} />}
                </div>
                <p className="mt-2 text-sm tabular-nums" data-testid={`roi-stats-${r.label}`}>
                  {s ? (
                    <>
                      Mean <strong>{fmtC(s.mean, 2)}</strong> · min {fmtC(s.min, 2)} · max {fmtC(s.max, 2)} · SD {s.std?.toFixed(2)} · {s.pixelCount} px
                      {!saved && <span className="ml-2 text-xs text-ink-muted">(preview — save to record)</span>}
                    </>
                  ) : (
                    <span className="text-ink-muted">No pixels inside this region.</span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
        {!dirty && capture.pairs.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium">Paired differences</p>
            <ul className="mt-1 space-y-1 text-sm tabular-nums" data-testid="pair-diffs">
              {capture.pairs.map((p) => (
                <li key={`${p.a}-${p.b}`}>
                  {p.a} − {p.b}: mean <strong>{p.meanDiff === null ? '—' : `${p.meanDiff > 0 ? '+' : ''}${p.meanDiff.toFixed(2)} °C`}</strong> · max {p.maxDiff === null ? '—' : `${p.maxDiff > 0 ? '+' : ''}${p.maxDiff.toFixed(2)} °C`}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-ink-muted">Differences are measurements. Interpretation depends on the capture protocol and clinical context.</p>
          </div>
        )}
      </Card>

      <ThermalFlagsCard shown={showFlags} onToggle={setShowFlags} flags={flags} unsaved={dirty} />
      {capture.status === 'approved' && <ThermalLabelsCard capture={capture} />}

      {editable && me?.role === 'doctor' && !dirty && <ReviewPanel c={capture} onDone={(d) => (qc.setQueryData(thermalKey(d.id), d), setRois(fromCapture(d)))} />}
      {editable && me?.role === 'doctor' && dirty && <Alert tone="info">Save the regions before reviewing.</Alert>}
    </div>
  )
}
