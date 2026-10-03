// Joins the first turns of one English consultation's synthetic speech (data/eval/audio/<id>/tNN.wav, made by synthesise-audio.ps1) into ONE
// WAV, with short silences between turns, so the browser's synthetic microphone can "speak" it (Chromium flag --use-file-for-fake-audio-capture).
// Used only by the opt-in real-model browser test (e2e/capture-real.spec.ts). The output is git-ignored synthetic speech.
//
//   node data/eval/consultations-v1/make-demo-wav.mjs [consultation id, default c01] [turns, default 8]
import fs from 'node:fs'
import path from 'node:path'

const id = process.argv[2] ?? 'c01'
const turns = Number(process.argv[3] ?? 8)
const dir = path.resolve(import.meta.dirname, '..', 'audio', id)
const GAP_MS = 700

function readWav(file) {
  const b = fs.readFileSync(file)
  let pos = 12
  let rate = 16000
  while (pos + 8 <= b.length) {
    const tag = b.toString('ascii', pos, pos + 4)
    const size = b.readUInt32LE(pos + 4)
    if (tag === 'fmt ') rate = b.readUInt32LE(pos + 12)
    if (tag === 'data') return { rate, pcm: b.subarray(pos + 8, pos + 8 + size) }
    pos += 8 + size + (size % 2)
  }
  throw new Error(`${file}: no audio data`)
}

const parts = []
let rate = 16000
for (let i = 0; i < turns; i++) {
  const w = readWav(path.join(dir, `t${String(i).padStart(2, '0')}.wav`))
  rate = w.rate
  parts.push(w.pcm, Buffer.alloc(Math.round((GAP_MS / 1000) * rate) * 2))
}
const pcm = Buffer.concat(parts)
const h = Buffer.alloc(44)
h.write('RIFF', 0, 'ascii')
h.writeUInt32LE(36 + pcm.length, 4)
h.write('WAVEfmt ', 8, 'ascii')
h.writeUInt32LE(16, 16)
h.writeUInt16LE(1, 20)
h.writeUInt16LE(1, 22)
h.writeUInt32LE(rate, 24)
h.writeUInt32LE(rate * 2, 28)
h.writeUInt16LE(2, 32)
h.writeUInt16LE(16, 34)
h.write('data', 36, 'ascii')
h.writeUInt32LE(pcm.length, 40)
const out = path.join(dir, '..', `${id}-demo.wav`)
fs.writeFileSync(out, Buffer.concat([h, pcm]))
console.log(`${out}: ${(pcm.length / 2 / rate).toFixed(1)} s`)
