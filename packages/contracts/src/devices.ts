import { z } from 'zod'
import { OptionalText, Text } from './common.ts'
import { VitalItem } from './vitals.ts'

export const DEVICE_KINDS = { wearable_band: 'Wearable band', smart_stethoscope: 'Smart stethoscope', thermal_camera: 'Thermal camera', other: 'Other device' } as const
export type DeviceKind = keyof typeof DEVICE_KINDS
export const DeviceKind = z.enum(Object.keys(DEVICE_KINDS) as [DeviceKind, ...DeviceKind[]])

/** How data from the device reaches ADAXAI. None of these has been tested with real hardware in this build. */
export const DEVICE_INTEGRATIONS = {
  not_integrated: 'Not integrated (registry only)',
  manual_upload: 'Files uploaded by staff',
  gateway_api: 'Gateway posts readings (API boundary)',
} as const
export type DeviceIntegration = keyof typeof DEVICE_INTEGRATIONS
export const DeviceIntegration = z.enum(Object.keys(DEVICE_INTEGRATIONS) as [DeviceIntegration, ...DeviceIntegration[]])

export const DeviceInput = z.object({
  kind: DeviceKind,
  label: Text(80),
  manufacturer: OptionalText(80),
  model: OptionalText(80),
  serialNumber: Text(80),
  integration: DeviceIntegration.default('not_integrated'),
  notes: OptionalText(500),
})
export type DeviceInput = z.input<typeof DeviceInput>
export const UpdateDeviceRequest = DeviceInput.partial().extend({ status: z.enum(['active', 'retired']).optional() })
export type UpdateDeviceRequest = z.input<typeof UpdateDeviceRequest>

export const Device = z.object({
  id: z.uuid(),
  kind: DeviceKind,
  label: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string(),
  status: z.enum(['active', 'retired']),
  integration: DeviceIntegration,
  notes: z.string().nullable(),
  hasToken: z.boolean(),
  tokenCreatedAt: z.string().nullable(),
  assignment: z.object({ id: z.uuid(), patientId: z.uuid(), patientName: z.string(), mrn: z.string(), assignedAt: z.string(), assignedByName: z.string().nullable() }).nullable(),
  createdAt: z.string(),
})
export type Device = z.infer<typeof Device>

export const AssignDeviceRequest = z.object({ patientId: z.uuid(), visitId: z.uuid().optional() })
export type AssignDeviceRequest = z.input<typeof AssignDeviceRequest>
export const EndAssignmentRequest = z.object({ reason: Text(200) })

/**
 * Body a device gateway sends to POST /api/device-ingest/readings with
 * `Authorization: Bearer <device token>` and `x-adaxai-csrf: 1`. The patient
 * is the one the device is currently assigned to; the gateway never names one.
 */
export const DeviceReadingsRequest = z.object({
  measuredAt: z.iso.datetime({ offset: true }),
  readings: z.array(VitalItem).min(1).max(20),
})
export type DeviceReadingsRequest = z.input<typeof DeviceReadingsRequest>

export const AUSCULTATION_SITES = {
  aortic: 'Aortic area',
  pulmonic: 'Pulmonic area',
  tricuspid: 'Tricuspid area',
  mitral: 'Mitral area (apex)',
  lung_right_upper: 'Right upper lung',
  lung_left_upper: 'Left upper lung',
  lung_right_lower: 'Right lower lung',
  lung_left_lower: 'Left lower lung',
  abdomen: 'Abdomen',
  other: 'Other',
} as const
export type AuscultationSite = keyof typeof AUSCULTATION_SITES
export const AuscultationSite = z.enum(Object.keys(AUSCULTATION_SITES) as [AuscultationSite, ...AuscultationSite[]])

export const AuscultationRecording = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  fileId: z.uuid(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  site: AuscultationSite,
  note: z.string().nullable(),
  device: z.object({ id: z.uuid(), label: z.string() }).nullable(),
  dataOrigin: z.string(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
})
export type AuscultationRecording = z.infer<typeof AuscultationRecording>
