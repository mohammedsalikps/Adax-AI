import type { ThermalFlags } from '@adaxai/contracts'
import { HttpError } from '../http/errors.ts'

export interface ExtractResult {
  width: number
  height: number
  minC: number
  maxC: number
  meanC: number
  /** float32 little-endian, row-major. */
  matrix: Buffer
  camera: { make: string | null; model: string | null; dateTime: string | null }
  parameters: Record<string, number | null>
  visibleJpeg: Buffer | null
  extractor: { name: string; version: string }
}

export interface RoiStatsResult {
  rois: { id: string; stats: { pixelCount: number; min: number | null; max: number | null; mean: number | null; std: number | null } }[]
  pairs: { a: string; b: string; meanDiff: number | null; maxDiff: number | null }[]
}

export interface RoiStatsInput {
  width: number
  height: number
  matrix: Buffer
  rois: { id: string; shape: 'rect' | 'ellipse'; x: number; y: number; width: number; height: number }[]
  pairs: { a: string; b: string }[]
}

export type FlagsInput = RoiStatsInput

export interface EvaluationResult {
  report: Record<string, unknown>
  markdown: string
}

/** The Python thermal service (stateless; never touches the database). */
export interface ThermalService {
  extract(file: Buffer, filename: string): Promise<ExtractResult>
  roiStats(input: RoiStatsInput): Promise<RoiStatsResult>
  /** Experimental rule-based flags: not validated, not diagnostic. */
  flags(input: FlagsInput): Promise<ThermalFlags>
  /** Evaluates a dataset ZIP against its clinician labels. */
  evaluate(datasetZip: Buffer): Promise<EvaluationResult>
}

const unavailable = () => new HttpError(503, 'thermal_unavailable', 'The thermal processing service is not reachable. Try again shortly.')

export function httpThermalService(baseUrl: string, fetchImpl: typeof fetch = fetch): ThermalService {
  async function call(path: string, init: RequestInit) {
    let res: Response
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(60_000) })
    } catch {
      throw unavailable()
    }
    const body = (await res.json().catch(() => null)) as { detail?: { error?: string; message?: string } } | null
    if (res.status === 422 || res.status === 413) {
      // Rejections (not radiometric, unsupported variant, too large) are user-facing.
      throw new HttpError(422, body?.detail?.error ?? 'thermal_rejected', body?.detail?.message ?? 'The thermal image could not be processed.')
    }
    if (!res.ok || !body) throw unavailable()
    return body as unknown
  }

  return {
    async extract(file, filename) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(file)], { type: 'image/jpeg' }), filename)
      const b = (await call('/extract', { method: 'POST', body: form })) as Omit<ExtractResult, 'matrix' | 'visibleJpeg'> & { matrix: string; visibleJpeg: string | null }
      return { ...b, matrix: Buffer.from(b.matrix, 'base64'), visibleJpeg: b.visibleJpeg ? Buffer.from(b.visibleJpeg, 'base64') : null }
    },
    async roiStats(input) {
      return (await call('/roi-stats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, matrix: input.matrix.toString('base64') }),
      })) as RoiStatsResult
    },
    async flags(input) {
      return (await call('/flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, matrix: input.matrix.toString('base64') }),
      })) as ThermalFlags
    },
    async evaluate(datasetZip) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(datasetZip)], { type: 'application/zip' }), 'dataset.zip')
      return (await call('/evaluate', { method: 'POST', body: form })) as EvaluationResult
    },
  }
}
