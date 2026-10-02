import { z } from 'zod'
import { OptionalText } from './common.ts'

export const IMAGE_TYPES = {
  wound_photo: 'Wound',
  skin_photo: 'Skin',
  injury_photo: 'Injury',
  clinical_document: 'Photo of a document or report',
  other_clinical: 'Other clinical photograph',
} as const
export type ImageType = keyof typeof IMAGE_TYPES
export const ImageType = z.enum(Object.keys(IMAGE_TYPES) as [ImageType, ...ImageType[]])

export const ImageUploadFields = z.object({
  imageType: ImageType,
  source: z.enum(['upload', 'camera']).default('upload'),
  bodySite: OptionalText(80),
  description: OptionalText(500),
  encounterId: z.uuid().optional(),
})

export const ImageDescriptionResult = z.object({
  quality: z.enum(['adequate', 'limited', 'inadequate']),
  qualityReason: z.string(),
  observations: z.array(z.object({ text: z.string(), location: z.string(), confidence: z.enum(['low', 'medium', 'high']) })),
  limitations: z.array(z.string()),
  summary: z.string(),
})

/** AI description of a photograph: unverified until a doctor reviews it. */
export const ImageAnalysis = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  result: ImageDescriptionResult,
  status: z.enum(['pending', 'accepted', 'edited', 'rejected', 'deferred', 'superseded']),
  finalText: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  producedBy: z.object({ provider: z.string(), model: z.string(), version: z.string().nullable() }),
  createdAt: z.string(),
})
export type ImageAnalysis = z.infer<typeof ImageAnalysis>

export const ClinicalImage = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  fileId: z.uuid(),
  previewFileId: z.uuid(),
  imageType: ImageType,
  source: z.enum(['upload', 'camera']),
  bodySite: z.string().nullable(),
  description: z.string().nullable(),
  width: z.number(),
  height: z.number(),
  metadata: z.object({ format: z.string(), hadExif: z.boolean(), hadGps: z.boolean(), originalName: z.string().nullable() }),
  dataOrigin: z.string(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  analyses: z.array(ImageAnalysis),
})
export type ClinicalImage = z.infer<typeof ClinicalImage>
