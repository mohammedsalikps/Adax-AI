// Usage (from apps/api, with the local speech service running):
//   npx tsx src/eval/stt.ts [--url http://127.0.0.1:8002] [--only c01,c09] [--sessions c01,c09,c12] [--write-md ../../data/eval/results/stt-v1.md]
//
// Speech-to-text evaluation on SYNTHETIC speech: the English consultations of data/eval/consultations-v1, read aloud by offline Windows
// text-to-speech voices (data/eval/consultations-v1/synthesise-audio.ps1), sent to the real local speech service through the same client the
// application uses. It measures (1) word error rate against the script, (2) language identification, (3) speed, (4) what the important-point
// rules find in the model's text compared with in the script, and (5) on long recordings, whether segment times follow the true times.
// The audio is clean, quiet and one voice at a time: these numbers say nothing about real clinic audio, accents, noise or other languages.
import fs from 'node:fs'
import path from 'node:path'
import { loadDataset, type Consultation } from './dataset.ts'
import { type Counts, f1, precision, recall, runExtraction } from './score.ts'
import { addWer, normaliseForWer, wer, werRate, zeroWer, type WerResult } from './wer.ts'
import { isLikelyNonSpeech, LocalSpeechTranscriber } from '../ai/stt.ts'
import type { SpeechResult } from '../ai/providers.ts'

const args = process.argv.slice(2)
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined)
const url = opt('url') ?? 'http://127.0.0.1:8002'
const only = opt('only')?.split(',')
const sessionIds = (opt('sessions') ?? 'c01,c09,c12').split(',').filter(Boolean)
const AUDIO_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'data', 'eval', 'audio')
const GAP_MS = 800

interface Wav {
  rate: number
  pcm: Buffer
}
function readWav(file: string): Wav {
  const b = fs.readFileSync(file)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`)
  let pos = 12
  let rate = 0
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4)
    const size = b.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      const bits = b.readUInt16LE(pos + 8 + 14)
      const channels = b.readUInt16LE(pos + 8 + 2)
      rate = b.readUInt32LE(pos + 8 + 4)
      if (bits !== 16 || channels !== 1) throw new Error(`${file}: expected 16-bit mono`)
    }
    if (id === 'data') return { rate, pcm: b.subarray(pos + 8, pos + 8 + size) }
    pos += 8 + size + (size % 2)
  }
  throw new Error(`${file} has no audio data`)
}
function wavBytes(rate: number, pcm: Buffer): Buffer {
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
  return Buffer.concat([h, pcm])
}
const msOf = (w: Wav) => Math.round((w.pcm.length / 2 / w.rate) * 1000)
const textOf = (r: SpeechResult) => r.segments.filter((s) => !isLikelyNonSpeech(s)).map((s) => s.text).join(' ')

const transcriber = new LocalSpeechTranscriber({ url })
const health = await transcriber.health()
if (health.state !== 'ready') {
  console.error(`The local speech service is not ready: ${health.reason ?? health.state}. Start it with "npm run dev:speech" and wait for the model to load.`)
  process.exit(1)
}

let data = loadDataset().filter((c) => c.language === 'en' && c.audio)
if (only) data = data.filter((c) => only.includes(c.id))
for (const c of data) if (!fs.existsSync(path.join(AUDIO_DIR, c.id, 't00.wav'))) throw new Error(`No audio for ${c.id}: run data/eval/consultations-v1/synthesise-audio.ps1 first`)

// ---- 1-4: every turn on its own -------------------------------------------------------------------------------------------------------
interface TurnResult {
  file: string
  split: string
  turn: number
  speaker: string
  ref: string
  hyp: string
  language: string | null
  languageProbability: number | null
  audioMs: number
  wallMs: number
  segments: number
  minConfidence: number | null
  wer: WerResult
}
const turns: TurnResult[] = []
const hypOf = new Map<string, string[]>()
let model = ''
for (const c of data) {
  const hyps: string[] = []
  for (let i = 0; i < c.turns.length; i++) {
    const wav = readWav(path.join(AUDIO_DIR, c.id, `t${String(i).padStart(2, '0')}.wav`))
    const t0 = performance.now()
    const r = await transcriber.transcribe(wavBytes(wav.rate, wav.pcm), 'audio/wav', 'turn.wav', {})
    const wallMs = performance.now() - t0
    model = `${r.model.id} (${r.model.runtime}, ${r.model.computeType ?? '?'}, weights sha256 ${r.model.weightsSha256 ?? 'unknown'})`
    const hyp = textOf(r)
    hyps.push(hyp)
    const conf = r.segments.map((s) => s.confidence).filter((x): x is number => x !== null)
    turns.push({
      file: c.id,
      split: c.split,
      turn: i,
      speaker: c.turns[i]!.speaker,
      ref: c.turns[i]!.text,
      hyp,
      language: r.language,
      languageProbability: r.languageProbability,
      audioMs: msOf(wav),
      wallMs: Math.round(wallMs),
      segments: r.segments.length,
      minConfidence: conf.length ? Math.min(...conf) : null,
      wer: wer(normaliseForWer(c.turns[i]!.text), normaliseForWer(hyp)),
    })
  }
  hypOf.set(c.id, hyps)
  console.error(`${c.id}: ${c.turns.length} turns transcribed`)
}

const sum = (xs: WerResult[]) => xs.reduce(addWer, zeroWer())
const pct = (x: number | null, d = 1) => (x === null ? '–' : `${(x * 100).toFixed(d)}%`)
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null)
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]! : null)
const group = (key: (t: TurnResult) => string) => {
  const m = new Map<string, TurnResult[]>()
  for (const t of turns) m.set(key(t), [...(m.get(key(t)) ?? []), t])
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}
const werRow = (name: string, ts: TurnResult[]) => {
  const w = sum(ts.map((t) => t.wer))
  const perTurn = ts.filter((t) => t.wer.refWords).map((t) => t.wer.errors / t.wer.refWords)
  return `| ${name} | ${ts.length} | ${w.refWords} | ${pct(werRate(w))} | ${w.substitutions} / ${w.deletions} / ${w.insertions} | ${pct(median(perTurn))} | ${pct(quantile(perTurn, 0.9))} | ${ts.filter((t) => t.wer.errors === 0).length} |`
}

const out: string[] = []
out.push(`Model: ${model}`)
out.push('')
out.push('**Word error rate by turn (synthetic speech, per-turn audio)**')
out.push('')
out.push('| Group | Turns | Reference words | WER | Sub / Del / Ins | Median turn WER | 90th pct turn WER | Exact turns |')
out.push('| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |')
out.push(werRow('All English files', turns))
for (const [k, ts] of group((t) => t.split)) out.push(werRow(`${k} split`, ts))
for (const [k, ts] of group((t) => t.speaker)) out.push(werRow(`${k} turns`, ts))
const short = turns.filter((t) => t.wer.refWords <= 5)
const long = turns.filter((t) => t.wer.refWords > 5)
out.push(werRow('Turns of 5 words or fewer', short))
out.push(werRow('Turns of more than 5 words', long))
out.push('')

const en = turns.filter((t) => t.language === 'en')
const enShort = short.filter((t) => t.language === 'en')
const enLong = long.filter((t) => t.language === 'en')
const wrong = turns.filter((t) => t.language !== 'en' && t.segments > 0)
out.push(`**Language identification** (every script is English; the model was not given a language): English reported for ${en.length} of ${turns.length} turns (${pct(en.length / turns.length)}); for turns of more than 5 words ${enLong.length} of ${long.length} (${pct(long.length ? enLong.length / long.length : null)}); for turns of 5 words or fewer ${enShort.length} of ${short.length} (${pct(short.length ? enShort.length / short.length : null)}). Turns with no text returned count as not English.`)
if (wrong.length) out.push(`Reported another language: ${wrong.map((t) => `${t.file} t${t.turn} -> ${t.language}`).slice(0, 12).join('; ')}.`)
const empty = turns.filter((t) => !t.hyp)
out.push(`Turns where the model returned no text at all: ${empty.length} of ${turns.length}.`)
out.push('')

const audioS = turns.reduce((n, t) => n + t.audioMs, 0) / 1000
const wallS = turns.reduce((n, t) => n + t.wallMs, 0) / 1000
out.push(`**Speed** (CPU, int8, one request at a time, this machine): ${audioS.toFixed(0)} s of audio transcribed in ${wallS.toFixed(0)} s (real-time factor ${(wallS / audioS).toFixed(2)}; below 1 is faster than real time). Median per-turn latency ${median(turns.map((t) => t.wallMs))} ms, 90th percentile ${quantile(turns.map((t) => t.wallMs), 0.9)} ms.`)
out.push('')

// ---- 4: what the rules find in the model's text --------------------------------------------------------------------------------------
const row = (name: string, c: Counts) => `| ${name} | ${c.tp + c.fn} | ${c.tp + c.fp} | ${c.tp} | ${pct(precision(c), 0)} | ${pct(recall(c), 0)} | ${pct(f1(c), 0)} |`
out.push('**Important points found in the speech model\'s text, compared with the same rules on the script** (point matching as in the extraction evaluation; all English files, dev and test together)')
out.push('')
out.push('| Input | Gold | Proposed | Matched | Precision | Recall | F1 |')
out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const condition of ['labelled', 'unlabelled'] as const) {
  const script = runExtraction(data, condition)
  const heard = runExtraction(data, condition, (c, i) => hypOf.get(c.id)![i]!)
  out.push(row(`Script text, speakers ${condition}`, script.overall))
  out.push(row(`Speech model text, speakers ${condition}`, heard.overall))
}
out.push('')
out.push('"Speakers labelled" is the best case (the real model identifies no speakers: the doctor assigns them, line by line); "unlabelled" is what the rules do when nobody has.')
out.push('')

// ---- 5: long recordings: do the times follow the true times? ------------------------------------------------------------------------------------
const sessions = data.filter((c) => sessionIds.includes(c.id))
if (sessions.length) {
  out.push('**Long recordings** (the whole consultation as one recording, 0.8 s of silence between turns; the model sees no turn boundaries)')
  out.push('')
  out.push('| File | Audio | Time to transcribe | Segments | Session WER | Turn starts found | Median start error | 90th pct start error | Times ordered and inside the audio |')
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
  for (const c of sessions as Consultation[]) {
    const parts: Buffer[] = []
    const truth: { start: number; end: number }[] = []
    let t = 0
    let rate = 16000
    const silence = (r: number) => Buffer.alloc(Math.round((GAP_MS / 1000) * r) * 2)
    for (let i = 0; i < c.turns.length; i++) {
      const w = readWav(path.join(AUDIO_DIR, c.id, `t${String(i).padStart(2, '0')}.wav`))
      rate = w.rate
      truth.push({ start: t, end: t + msOf(w) })
      parts.push(w.pcm, silence(w.rate))
      t += msOf(w) + GAP_MS
    }
    const t0 = performance.now()
    const r = await transcriber.transcribe(wavBytes(rate, Buffer.concat(parts)), 'audio/wav', 'session.wav', {})
    const wall = (performance.now() - t0) / 1000
    const kept = r.segments.filter((s) => !isLikelyNonSpeech(s))
    const ref = normaliseForWer(c.turns.map((x) => x.text).join(' '))
    const w = wer(ref, normaliseForWer(kept.map((s) => s.text).join(' ')))
    // For each turn: the first segment that overlaps it, and how far its start is from the turn's true start.
    const errors: number[] = []
    for (const tr of truth) {
      const seg = kept.find((s) => s.endMs > tr.start + 200 && s.startMs < tr.end - 200)
      if (seg) errors.push(Math.abs(seg.startMs - tr.start))
    }
    const ordered = kept.every((s, i) => s.startMs <= s.endMs && (i === 0 || kept[i - 1]!.startMs <= s.startMs)) && kept.every((s) => s.startMs >= 0 && s.endMs <= r.durationMs + 2000)
    out.push(`| ${c.id} | ${(t / 1000).toFixed(0)} s | ${wall.toFixed(0)} s | ${kept.length} | ${pct(werRate(w))} | ${errors.length} of ${truth.length} | ${median(errors)} ms | ${quantile(errors, 0.9)} ms | ${ordered ? 'yes' : 'NO'} |`)
    console.error(`${c.id}: session of ${(t / 1000).toFixed(0)} s transcribed in ${wall.toFixed(0)} s`)
  }
  out.push('')
  out.push('"Start error" compares the start of the first speech-model segment that overlaps a turn with the true start of that turn. A segment that covers two turns starts early for the second one; the model decides segment boundaries.')
}

const text = out.join('\n')
console.log(text)
const md = opt('write-md')
if (md) fs.writeFileSync(path.resolve(md), `${text}\n`)
// Per-turn detail (scripts and the model's text, synthetic) stays out of the repository with the audio.
fs.writeFileSync(path.join(AUDIO_DIR, 'last-run.json'), JSON.stringify({ model, turns }, null, 1))
