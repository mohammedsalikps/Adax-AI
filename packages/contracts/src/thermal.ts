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
  dataOrigin: z.lazy(() => DataOrigin),
  /** Clinician labels, including withdrawn ones (shown struck through). */
  labels: z.array(z.lazy(() => ThermalLabel)),
})
export type ThermalCapture = z.infer<typeof ThermalCapture>

export const ThermalReviewRequest = z.object({ decision: z.enum(['approved', 'rejected']), note: OptionalText(500) })
export type ThermalReviewRequest = z.input<typeof ThermalReviewRequest>

/** Where the image data came from. Anything but `clinical` is excluded from any performance claim. */
export const DataOrigin = z.enum(['clinical', 'synthetic', 'public_sample'])
export type DataOrigin = z.infer<typeof DataOrigin>
export const DATA_ORIGIN_LABELS: Record<DataOrigin, string> = {
  clinical: 'Clinical',
  synthetic: 'Synthetic / demonstration',
  public_sample: 'Public sample file',
}

// ---------------------------------------------------------------------------
// Clinician labels (ground truth for future evaluation). Versioned taxonomy.
// ---------------------------------------------------------------------------

export const THERMAL_TAXONOMY_VERSION = 'thermal-labels-v1'

export const CAPTURE_FINDINGS = {
  no_significant_finding: 'No significant thermal finding',
  inflammatory_pattern: 'Pattern consistent with inflammation',
  infective_pattern: 'Pattern consistent with infection',
  vascular_pattern: 'Pattern consistent with reduced perfusion',
  musculoskeletal_pattern: 'Pattern consistent with musculoskeletal injury',
  other_finding: 'Other finding',
  uninterpretable: 'Not interpretable (image quality or protocol)',
} as const
export const ROI_FINDINGS = {
  normal: 'Normal for this region',
  warmer_than_expected: 'Warmer than expected',
  cooler_than_expected: 'Cooler than expected',
  indeterminate: 'Indeterminate',
} as const
/** How the label was established. Clinical impression alone is the weakest reference. */
export const REFERENCE_STANDARDS = {
  clinical_impression: 'Clinical impression at the time',
  confirmed_investigation: 'Confirmed by investigation (lab or imaging)',
  follow_up: 'Confirmed at follow-up',
} as const
export const LABEL_CERTAINTY = { certain: 'Certain', probable: 'Probable', uncertain: 'Uncertain' } as const

type Keys<T> = [keyof T & string, ...(keyof T & string)[]]
const keys = <T extends object>(o: T) => Object.keys(o) as Keys<T>

export const ThermalLabelInput = z
  .object({
    scope: z.enum(['capture', 'roi']),
    /** Region label, for scope `roi`. */
    roiLabel: z.string().trim().max(40).nullable().optional(),
    code: z.string(),
    referenceStandard: z.enum(keys(REFERENCE_STANDARDS)),
    certainty: z.enum(keys(LABEL_CERTAINTY)),
    note: OptionalText(500),
  })
  .superRefine((v, ctx) => {
    const codes: readonly string[] = keys(v.scope === 'capture' ? CAPTURE_FINDINGS : ROI_FINDINGS)
    if (!codes.includes(v.code)) ctx.addIssue({ code: 'custom', path: ['code'], message: 'Choose a finding from the list' })
    if (v.scope === 'roi' && !v.roiLabel) ctx.addIssue({ code: 'custom', path: ['roiLabel'], message: 'Choose a region' })
    if (v.scope === 'capture' && v.roiLabel) ctx.addIssue({ code: 'custom', path: ['roiLabel'], message: 'Whole-image labels have no region' })
  })
export type ThermalLabelInput = z.input<typeof ThermalLabelInput>

export const ThermalLabel = z.object({
  id: z.uuid(),
  scope: z.enum(['capture', 'roi']),
  roiLabel: z.string().nullable(),
  code: z.string(),
  referenceStandard: z.string(),
  certainty: z.string(),
  note: z.string().nullable(),
  taxonomyVersion: z.string(),
  labelledById: z.uuid(),
  labelledByName: z.string().nullable(),
  labelledAt: z.string(),
  withdrawn: z.object({ at: z.string(), byName: z.string().nullable(), reason: z.string() }).nullable(),
})
export type ThermalLabel = z.infer<typeof ThermalLabel>

export const WithdrawLabelRequest = z.object({ reason: Text(300) })

// ---------------------------------------------------------------------------
// Experimental rule-based flags (NOT validated, NOT diagnostic).
// ---------------------------------------------------------------------------

export const ThermalFlags = z.object({
  version: z.string(),
  validated: z.literal(false),
  disclaimer: z.string(),
  params: z.object({ asymmetry_threshold_c: z.number(), hotspot_k: z.number(), hotspot_min_pixels: z.number(), max_hotspots: z.number() }),
  image: z.object({ meanC: z.number(), stdC: z.number(), hotspotThresholdC: z.number() }),
  hotspots: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), pixelCount: z.number(), maxC: z.number(), meanC: z.number(), aboveImageMeanC: z.number() })),
  asymmetry: z.array(z.object({ a: z.string(), b: z.string(), meanDiffC: z.number(), flagged: z.boolean() })),
})
export type ThermalFlags = z.infer<typeof ThermalFlags>

// ---------------------------------------------------------------------------
// De-identified dataset exports and their evaluation.
// ---------------------------------------------------------------------------

export const THERMAL_DATASET_SCHEMA = 'adaxai-thermal-dataset/1'

export const ThermalDataSummary = z.object({
  captures: z.object({ draft: z.number(), approved: z.number(), rejected: z.number() }),
  approvedWithResearchConsent: z.number(),
  labelledCaptures: z.number(),
  activeLabels: z.number(),
  labelCounts: z.record(z.string(), z.number()),
  dataOrigins: z.record(z.string(), z.number()),
})
export type ThermalDataSummary = z.infer<typeof ThermalDataSummary>

export const ThermalDatasetExport = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  fileSha256: z.string(),
  sizeBytes: z.number(),
  summary: z.object({
    captures: z.number(),
    subjects: z.number(),
    labelledCaptures: z.number(),
    dataOrigins: z.record(z.string(), z.number()),
    excludedNoResearchConsent: z.number(),
  }),
  evaluation: z.object({ at: z.string(), report: z.record(z.string(), z.unknown()), markdown: z.string() }).nullable(),
})
export type ThermalDatasetExport = z.infer<typeof ThermalDatasetExport>
