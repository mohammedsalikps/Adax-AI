// Validator for the synthetic consultation evaluation dataset (consultations-v1).
// Usage (from the repository root):  node data/eval/consultations-v1/validate.mjs
// No dependencies. Exits non-zero on any problem.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

const CATEGORIES = [
  'chief_complaint',
  'symptom',
  'duration',
  'past_medical_history',
  'medication_history',
  'allergy',
  'family_history',
  'examination_finding',
  'vital_sign',
  'clinician_assessment',
  'plan',
  'medication_mention',
  'investigation_mention',
  'patient_concern',
  'follow_up',
  'red_flag',
];
const SPEAKERS = ['Doctor', 'Patient'];
const SPLITS = ['dev', 'test'];
const DOCTOR_ONLY = new Set([
  'examination_finding',
  'vital_sign',
  'clinician_assessment',
  'plan',
  'medication_mention',
]);
const PATIENT_ONLY = new Set([
  'chief_complaint',
  'symptom',
  'past_medical_history',
  'medication_history',
  'allergy',
  'family_history',
  'patient_concern',
  'red_flag',
]);

const problems = [];
const problem = (file, msg) => problems.push(`${file}: ${msg}`);

const norm = (s) => String(s).normalize('NFC').toLowerCase();

const files = readdirSync(dir)
  .filter((f) => /^[chx]\d\d\.json$/.test(f))
  .sort();

const expected = [];
for (let i = 1; i <= 12; i++) expected.push(`c${String(i).padStart(2, '0')}.json`);
expected.push('h01.json', 'h02.json', 'x01.json');
for (const e of expected) if (!files.includes(e)) problem(e, 'file is missing');
for (const f of files) if (!expected.includes(f)) problem(f, 'unexpected file name');

const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
const perFile = []; // { id, lang, turns, gold, byCat, goldTurns, uncertain }

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch (e) {
    problem(file, `invalid JSON: ${e.message}`);
    continue;
  }
  const base = file.replace(/\.json$/, '');
  const kind = base[0]; // c, h or x
  const n = Number(base.slice(1));

  if (doc.id !== base) problem(file, `id "${doc.id}" does not match the file name`);
  if (!SPLITS.includes(doc.split)) problem(file, `split must be dev or test, got "${doc.split}"`);
  const wantSplit = kind === 'c' && n >= 1 && n <= 8 ? 'dev' : 'test';
  if (doc.split !== wantSplit) problem(file, `split should be "${wantSplit}", got "${doc.split}"`);
  if (doc.synthetic !== true) problem(file, 'synthetic must be true');
  const wantLang = kind === 'c' ? 'en' : kind === 'h' ? 'hi' : 'hi-Latn';
  if (doc.language !== wantLang) problem(file, `language should be "${wantLang}", got "${doc.language}"`);
  if (doc.audio !== (kind === 'c')) problem(file, `audio should be ${kind === 'c'}`);
  if (doc.supported !== (kind === 'c')) problem(file, `supported should be ${kind === 'c'}`);
  if (typeof doc.scenario !== 'string' || !doc.scenario.trim()) problem(file, 'scenario must be a non-empty string');
  if (typeof doc.notes !== 'string' || !doc.notes.trim()) problem(file, 'notes must be a non-empty string');

  if (!Array.isArray(doc.turns)) {
    problem(file, 'turns must be an array');
    continue;
  }
  const minTurns = kind === 'c' ? 14 : 12;
  const maxTurns = kind === 'c' ? 26 : kind === 'h' ? 16 : 20;
  if (doc.turns.length < minTurns || doc.turns.length > maxTurns) {
    problem(file, `turn count ${doc.turns.length} outside ${minTurns}-${maxTurns}`);
  }
  doc.turns.forEach((t, i) => {
    if (!t || !SPEAKERS.includes(t.speaker)) problem(file, `turn ${i}: speaker must be Doctor or Patient`);
    if (!t || typeof t.text !== 'string' || !t.text.trim()) {
      problem(file, `turn ${i}: text must be a non-empty string`);
      return;
    }
    if (kind === 'c') {
      if (!/^[\x20-\x7e]+$/.test(t.text)) problem(file, `turn ${i}: text must be plain printable ASCII`);
      if (/[%/+&"]/.test(t.text)) problem(file, `turn ${i}: text contains a disallowed symbol (% / + & or a double quote)`);
      if (/\b(mg|bd|od|tds|bid|tid)\b/i.test(t.text)) problem(file, `turn ${i}: text contains an abbreviation a synthesiser may mispronounce`);
    }
    if (i > 0 && doc.turns[i - 1] && doc.turns[i - 1].speaker === t.speaker) {
      problem(file, `turn ${i}: same speaker as the previous turn (expected alternation)`);
    }
  });

  if (!Array.isArray(doc.gold)) {
    problem(file, 'gold must be an array');
    continue;
  }
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const seen = new Set();
  const goldTurns = new Set();
  let uncertain = 0;
  doc.gold.forEach((g, gi) => {
    const where = `gold[${gi}]`;
    if (!g || !CATEGORIES.includes(g.category)) {
      problem(file, `${where}: unknown category "${g && g.category}"`);
      return;
    }
    if (!Number.isInteger(g.turn) || g.turn < 0 || g.turn >= doc.turns.length) {
      problem(file, `${where}: turn ${g.turn} is not a valid index`);
      return;
    }
    if (typeof g.key !== 'string' || !g.key.trim()) {
      problem(file, `${where}: key must be a non-empty string`);
      return;
    }
    if (g.key !== g.key.toLowerCase()) problem(file, `${where}: key "${g.key}" must be lowercase`);
    if (typeof g.negated !== 'boolean') problem(file, `${where}: negated must be a boolean`);
    if (typeof g.uncertain !== 'boolean') problem(file, `${where}: uncertain must be a boolean`);
    const turn = doc.turns[g.turn];
    if (!norm(turn.text).includes(norm(g.key))) {
      problem(file, `${where}: key "${g.key}" does not occur in turn ${g.turn} ("${turn.text.slice(0, 60)}...")`);
    }
    if (DOCTOR_ONLY.has(g.category) && turn.speaker !== 'Doctor') {
      problem(file, `${where}: ${g.category} should be on a Doctor turn (turn ${g.turn} is ${turn.speaker})`);
    }
    if (PATIENT_ONLY.has(g.category) && turn.speaker !== 'Patient') {
      problem(file, `${where}: ${g.category} should be on a Patient turn (turn ${g.turn} is ${turn.speaker})`);
    }
    const id = `${g.category}|${g.turn}|${g.key}`;
    if (seen.has(id)) problem(file, `${where}: duplicate row for ${g.category} / turn ${g.turn} / "${g.key}"`);
    seen.add(id);
    byCat[g.category]++;
    totals[g.category]++;
    goldTurns.add(g.turn);
    if (g.uncertain) uncertain++;
  });
  if (byCat.chief_complaint !== 1) problem(file, `expected exactly one chief_complaint, found ${byCat.chief_complaint}`);

  perFile.push({ id: base, kind, doc, byCat, goldTurns, uncertain });
}

// Coverage requirements across the twelve English consultations.
const en = perFile.filter((p) => p.kind === 'c');
const countFiles = (pred) => en.filter(pred).length;
const hasRow = (p, pred) => p.doc.gold.some(pred);
const coverage = [
  ['negated symptom', countFiles((p) => hasRow(p, (g) => g.category === 'symptom' && g.negated)), 3],
  ['allergy statement', countFiles((p) => p.byCat.allergy > 0), 3],
  ['medication the patient takes', countFiles((p) => p.byCat.medication_history > 0), 4],
  ['follow_up', countFiles((p) => p.byCat.follow_up > 0), 5],
  ['investigation_mention', countFiles((p) => p.byCat.investigation_mention > 0), 5],
  ['patient_concern', countFiles((p) => p.byCat.patient_concern > 0), 3],
  ['family_history', countFiles((p) => p.byCat.family_history > 0), 2],
  ['vital_sign', countFiles((p) => p.byCat.vital_sign > 0), 2],
  ['uncertain row', countFiles((p) => p.uncertain > 0), 7],
  [
    'doctor medicine not in patient medicines',
    countFiles((p) => {
      const taken = new Set(p.doc.gold.filter((g) => g.category === 'medication_history').map((g) => g.key));
      return p.doc.gold.some((g) => g.category === 'medication_mention' && !taken.has(g.key));
    }),
    4,
  ],
];
const nkda = en.some((p) => hasRow(p, (g) => g.category === 'allergy' && g.negated && g.key === 'allerg'));
if (!nkda) problem('coverage', 'no English file has a no-known-drug-allergies row (allergy, negated, key "allerg")');
const redFlagFiles = countFiles((p) => p.byCat.red_flag > 0);
if (redFlagFiles < 2 || redFlagFiles > 3) problem('coverage', `red_flag appears in ${redFlagFiles} English files, expected 2-3`);
for (const [name, have, need] of coverage) {
  if (have < need) problem('coverage', `${name}: ${have} English files, need at least ${need}`);
}

// Per-file summary.
const pad = (s, w) => String(s).padEnd(w);
console.log('Per-file summary');
for (const p of perFile) {
  const cats = CATEGORIES.filter((c) => p.byCat[c] > 0)
    .map((c) => `${c}=${p.byCat[c]}`)
    .join(' ');
  console.log(
    `${pad(p.id, 4)} ${pad(p.doc.split, 4)} ${pad(p.doc.language, 7)} turns=${pad(p.doc.turns.length, 2)} gold=${pad(p.doc.gold.length, 2)} ${cats}`,
  );
}
console.log('');
console.log('Gold rows by category (all files)');
let grand = 0;
for (const c of CATEGORIES) {
  console.log(`${pad(c, 22)} ${totals[c]}`);
  grand += totals[c];
}
console.log(`${pad('TOTAL', 22)} ${grand}`);
console.log('');
console.log('Coverage over the 12 English files');
for (const [name, have, need] of coverage) console.log(`${pad(name, 42)} ${have} (need >= ${need})`);
console.log(`${pad('red_flag files', 42)} ${redFlagFiles} (need 2-3)`);
console.log(`${pad('no-known-drug-allergies row', 42)} ${nkda ? 'yes' : 'NO'}`);
console.log('');

if (problems.length) {
  console.log(`FAILED: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`OK: ${perFile.length} files valid, ${grand} gold rows.`);
