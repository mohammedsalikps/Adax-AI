import type { ThermalCapture } from '@adaxai/contracts'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api.ts'

export const thermalKey = (id: string) => ['thermal', id] as const

export function useThermal(id: string | undefined) {
  return useQuery({ queryKey: thermalKey(id ?? ''), queryFn: () => api<ThermalCapture>(`/thermal/${id}`), enabled: !!id })
}

export function usePatientThermal(patientId: string) {
  return useQuery({ queryKey: ['patient', patientId, 'thermal'], queryFn: () => api<{ captures: ThermalCapture[] }>(`/patients/${patientId}/thermal`), select: (d) => d.captures })
}

/** Fetches the float32 temperature matrix (°C, row-major). */
export function useMatrix(c: ThermalCapture | undefined) {
  return useQuery({
    queryKey: ['thermal-matrix', c?.matrixFileId],
    enabled: !!c,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`/api/files/${c!.matrixFileId}`, { credentials: 'same-origin' })
      if (!res.ok) throw new ApiError(res.status, 'matrix_unavailable', 'The temperature data could not be loaded.')
      const buf = await res.arrayBuffer()
      if (buf.byteLength !== c!.width * c!.height * 4) throw new ApiError(500, 'matrix_size', 'The temperature data has an unexpected size.')
      return new Float32Array(buf)
    },
  })
}

export type PaletteName = 'iron' | 'grayscale' | 'rainbow'

const STOPS: Record<PaletteName, [number, [number, number, number]][]> = {
  grayscale: [
    [0, [0, 0, 0]],
    [1, [255, 255, 255]],
  ],
  iron: [
    [0, [0, 0, 20]],
    [0.25, [80, 20, 130]],
    [0.5, [200, 40, 80]],
    [0.75, [250, 150, 20]],
    [1, [255, 250, 220]],
  ],
  rainbow: [
    [0, [20, 20, 140]],
    [0.25, [0, 160, 230]],
    [0.5, [40, 200, 60]],
    [0.75, [250, 220, 0]],
    [1, [220, 30, 30]],
  ],
}

/** 256-entry RGB lookup table, linear interpolation between palette stops. */
export function paletteLut(name: PaletteName): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3)
  const stops = STOPS[name]
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let j = 0
    while (j < stops.length - 2 && t > stops[j + 1]![0]) j++
    const [t0, c0] = stops[j]!
    const [t1, c1] = stops[j + 1]!
    const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = c0[k]! + (c1[k]! - c0[k]!) * f
  }
  return lut
}

export const paletteCss = (name: PaletteName) => `linear-gradient(to right, ${STOPS[name].map(([t, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${t * 100}%`).join(', ')})`

export interface RoiGeom {
  shape: 'rect' | 'ellipse'
  x: number
  y: number
  width: number
  height: number
}

/** Same rule as the thermal service: pixels whose centres fall inside the region. */
export function roiPreviewStats(m: Float32Array, w: number, h: number, r: RoiGeom) {
  let n = 0
  let sum = 0
  let sq = 0
  let min = Infinity
  let max = -Infinity
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w - 1, Math.ceil(r.x + r.width))
  const y1 = Math.min(h - 1, Math.ceil(r.y + r.height))
  const rx = r.width / 2
  const ry = r.height / 2
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5
      const cy = y + 0.5
      const inside = r.shape === 'rect' ? cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height : ((cx - (r.x + rx)) / rx) ** 2 + ((cy - (r.y + ry)) / ry) ** 2 <= 1
      if (!inside) continue
      const v = m[y * w + x]!
      if (!Number.isFinite(v)) continue
      n++
      sum += v
      sq += v * v
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!n) return null
  const mean = sum / n
  return { pixelCount: n, min, max, mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) }
}

export const fmtC = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(digits)} °C`)
