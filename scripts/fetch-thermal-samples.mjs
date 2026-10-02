#!/usr/bin/env node
// Downloads public FLIR sample images used by the thermal tests and demos into
// samples/thermal (git-ignored). Each file is verified against a pinned SHA-256.
//
// Source: https://github.com/nationaldronesau/FlirImageExtractor (examples/),
// MIT License, Copyright (c) 2020 National Drones. These are NOT images from
// the clinic's camera: they only show that the pipeline handles these files.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib/env.mjs'

const BASE = 'https://raw.githubusercontent.com/nationaldronesau/FlirImageExtractor/master/examples'
export const THERMAL_SAMPLES = [
  { file: 'ax8.jpg', sha256: '6cb40ab3967ca890fc90b2f4a53e6c4974d1865b4274f15fc8710da684591409', note: 'FLIR AX8, 80x60 radiometric' },
  { file: 'flir_example.jpg', sha256: '7cbe5d9a04fb4daea8d750cbf8ea050f3c3a2fd5b530e756dee4d6b8f6615b58', note: 'FLIR camera, 240x320 radiometric' },
  { file: 'zenmuse_xtr.jpg', sha256: 'c2ae58509119695cea72c27a344569e6e53196e968e5e091671e8f7d1813a74f', note: 'DJI Zenmuse XT-R: not decodable by flyr (used to test rejection)' },
]
const DIR = path.join(ROOT, 'samples', 'thermal')
const say = (m) => console.log(`[samples] ${m}`)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

fs.mkdirSync(DIR, { recursive: true })
let failed = 0
for (const s of THERMAL_SAMPLES) {
  const dest = path.join(DIR, s.file)
  if (fs.existsSync(dest) && sha(fs.readFileSync(dest)) === s.sha256) {
    say(`${s.file}: present and verified`)
    continue
  }
  try {
    const res = await fetch(`${BASE}/${s.file}`, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = Buffer.from(await res.arrayBuffer())
    if (sha(data) !== s.sha256) throw new Error('checksum mismatch (file changed upstream?)')
    fs.writeFileSync(dest, data)
    say(`${s.file}: downloaded and verified (${s.note})`)
  } catch (e) {
    failed++
    say(`${s.file}: NOT available (${e.message}). Thermal sample tests will be skipped.`)
  }
}
fs.writeFileSync(
  path.join(DIR, 'SOURCE.txt'),
  `Source: ${BASE.replace('raw.githubusercontent.com', 'github.com').replace('/master/', '/tree/master/')}\nLicense: MIT, Copyright (c) 2020 National Drones\nThese are third-party sample images, not data from the clinic's camera.\n`,
)
process.exitCode = failed ? 1 : 0
