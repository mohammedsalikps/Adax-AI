import { z } from 'zod'
import { OptionalText, Text } from './common.ts'

export const THERMAL_VIEWS = ['anterior', 'posterior', 'left_lateral', 'right_lateral', 'plantar', 'dorsal', 'other'] as const

/** How the image was taken. Thermal readings depend heavily on these conditions. */
export const CaptureProtocol = z.object({
  bodyRegion: Text(80),
  view: z.enum(THERMAL_VIEWS).default('anterior'),
  roomTempC: z.number().min(10).max(40).nullable().optional(),
  acclimatisationMin: z.number().int().min(0).max(120).nullable().optional(),
  distanceM: z.number().min(0.1).max(10).nullable().optional(),
  notes: OptionalText(500),
})
export type CaptureProtocol = z.input<typeof CaptureProtocol>

export const RoiShape = z.enum(['rect', 'ellipse'])
export const ThermalRoiInput = z.object({
  label: Text(40),
  shape: RoiShape,
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Label of the contralateral region to compare with (e.g. "Left knee" vs "Right knee"). */
  pairWith: z.string().trim().max(40).nullable().optional(),
})
export type ThermalRoiInput = z.input<typeof ThermalRoiInput>

export const SaveRoisRequest = z.object({ rois: z.array(ThermalRoiInput).max(20) }).superRefine((v, ctx) => {
  const labels = v.rois.map((r) => r.label.trim().toLowerCase())
  if (new Set(labels).size !== labels.length) ctx.addIssue({ code: 'custom', path: ['rois'], message: 'Region labels must be unique' })
  v.rois.forEach((r, i) => {
    if (r.pairWith && !labels.includes(r.pairWith.trim().toLowerCase())) ctx.addIssue({ code: 'custom', path: ['rois', i, 'pairWith'], message: 'Pair with an existing region label' })
    if (r.pairWith && r.pairWith.trim().toLowerCase() === r.label.trim().toLowerCase()) ctx.addIssue({ code: 'custom', path: ['rois', i, 'pairWith'], message: 'A region cannot be paired with itself' })
  })
})
export type SaveRoisRequest = z.input<typeof SaveRoisRequest>

export const RoiStats = z.object({ pixelCount: z.number().int(), min: z.number().nullable(), max: z.number().nullable(), mean: z.number().nullable(), std: z.number().nullable() })
export type RoiStats = z.infer<typeof RoiStats>

export const ThermalRoi = ThermalRoiInput.required().extend({ id: z.uuid(), pairWith: z.string().nullable(), stats: RoiStats })
export type ThermalRoi = z.infer<typeof ThermalRoi>
export const ThermalPair = z.object({ a: z.string(), b: z.string(), meanDiff: z.number().nullable(), maxDiff: z.number().nullable() })
export type ThermalPair = z.infer<typeof ThermalPair>

export const ThermalStatus = z.enum(['draft', 'approved', 'rejected'])

const nullableNum = z.number().nullable()
export const ThermalCapture = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  status: ThermalStatus,
  originalName: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
  minC: z.number(),
  maxC: z.number(),
  meanC: z.number(),
  camera: z.object({ make: z.string().nullable(), model: z.string().nullable(), dateTime: z.string().nullable() }),
  parameters: z.object({
    emissivity: nullableNum,
    objectDistanceM: nullableNum,
    reflectedTempC: nullableNum,
    atmosphericTempC: nullableNum,
    relativeHumidity: nullableNum,
    irWindowTempC: nullableNum,
    irWindowTransmission: nullableNum,
  }),
  protocol: CaptureProtocol.extend({ view: z.enum(THERMAL_VIEWS) }),
  extractor: z.object({ name: z.string(), version: z.string() }),
  rawFileId: z.uuid(),
  matrixFileId: z.uuid(),
  visibleFileId: z.uuid().nullable(),
  rois: z.array(ThermalRoi),
  pairs: z.array(ThermalPair),
  review: z.object({ byName: z.string().nullable(), at: z.string(), note: z.string().nullable() }).nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
})
export type ThermalCapture = z.infer<typeof ThermalCapture>

export const ThermalReviewRequest = z.object({ decision: z.enum(['approved', 'rejected']), note: OptionalText(500) })
export type ThermalReviewRequest = z.input<typeof ThermalReviewRequest>
