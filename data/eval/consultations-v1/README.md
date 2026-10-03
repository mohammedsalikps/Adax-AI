# Synthetic consultation evaluation set, v1

Fifteen scripted, fictional doctor-patient consultations (General Medicine outpatient, India and UK flavoured everyday English, plus three non-English files) with hand-labelled "gold" important points. It is meant for two evaluations:

1. A rule-based "important points" extractor (does it find the clinically relevant statements, and does it keep negation and uncertainty?).
2. A speech-to-text evaluation (the English files are meant to be read aloud by an offline text-to-speech voice and the transcript compared with the script).

## Provenance

- All text was written by an AI assistant (Claude) as fictional scripted dialogue on 2026-10-03.
- No real patient, clinic or person is described. Names are invented first names. There are no real phone numbers or identifiers.
- The content was **NOT reviewed by a clinician**. The medical content is ordinary and illustrative and is **NOT clinical guidance**. Doses, drug choices and assessments are plausible-sounding but have not been checked and must not be used for care.
- The gold labels were assigned by the same author who wrote the dialogue and are one person's judgement. There is a single annotator and there is no inter-annotator agreement. Borderline calls are noted per file in the `notes` field (for example environmental allergy in c05, hypothetical safety-net advice not labelled as red_flag in c04, c10 and c11).

## Limitations

- **Small.** 15 files, 406 gold rows in total (216 in dev, 130 in the English test files, 60 in the three non-English files). Any metric computed on it has wide uncertainty; treat differences of a few points as noise, and the rare categories (red_flag has only 4 rows) as anecdotes.
- **Scripted, not real speech.** The dialogues contain hesitations, self-corrections and interruptions, but they are written text, tidier than real consultations. The English files are meant to be read aloud by an offline text-to-speech voice. That is **not representative of real clinic speech**: no accents, background noise, overlapping speakers, children, elderly or unwell speakers, or phone-quality audio. Speech-to-text results on synthetic voices will usually be better than in a real clinic.
- **One specialty, one setting.** General Medicine outpatient only. No emergencies beyond the two scripted urgent cases, no obstetrics, no mental health, no paediatric examination beyond c05.
- **Hindi and Hinglish files** (h01, h02, x01) exist only to measure behaviour on an unsupported language (an English-rule extractor is not expected to handle them; ideally it declines or reports low confidence rather than inventing points). They have no audio (`"audio": false`) and are marked `"supported": false`. Their gold keys are literal substrings of the script, in Devanagari (h01, h02) or Roman script (x01).

## Split

- `dev` (c01 to c08): used while building and tuning the extractor rules. Looking at these files, fixing rules against them and re-running is expected.
- `test` (c09 to c12, h01, h02, x01): held out. Not to be inspected while building rules; run **once at the end** to report a number. After the test split has been looked at for tuning it is no longer a test set.

## Files

| id | split | language | scenario | turns | gold rows |
|----|-------|----------|----------|------:|----------:|
| c01 | dev | en | Adult with three days of fever, dry cough and sore throat; likely viral infection | 24 | 23 |
| c02 | dev | en | Diabetes review in a woman with tingling feet; HbA1c and statin added | 26 | 24 |
| c03 | dev | en | Hypertension review with ankle swelling that may be a side effect of amlodipine | 24 | 27 |
| c04 | dev | en | Burning upper abdominal pain after ibuprofen; possible black stool; gastritis suspected | 24 | 29 |
| c05 | dev | en | Five-year-old boy with cough and runny nose, brought by his mother; mild wheeze | 26 | 33 |
| c06 | dev | en | Young man with a week of band-like headache, poor sleep and daily painkillers | 24 | 27 |
| c07 | dev | en | Taxi driver with low back pain radiating to the left leg; penicillin allergy | 26 | 26 |
| c08 | dev | en | Young woman with burning urine and frequency; likely simple UTI; cotrimoxazole rash | 24 | 27 |
| c09 | test | en | Man with exertional chest pain radiating to the left arm; possible angina; sent to hospital | 26 | 29 |
| c10 | test | en | Student with an itchy rash after an unnamed antibiotic and a new soap; hives | 26 | 36 |
| c11 | test | en | Asthma follow-up, control worse after stopping a steroid inhaler; combiflam makes him wheeze | 26 | 28 |
| c12 | test | en | Elderly man with right knee osteoarthritis and a possibly swollen painful left calf | 26 | 37 |
| h01 | test | hi | Hindi (Devanagari): fever and body ache for three days; viral fever | 16 | 17 |
| h02 | test | hi | Hindi (Devanagari): stomach burning in a woman with diabetes; probable gastritis | 16 | 19 |
| x01 | test | hi-Latn | Hinglish (Roman script): loose motions and stomach pain; stomach infection | 18 | 24 |

c05 is a child brought by his mother. The speaker is still labelled `Patient` (the mother speaking about the child); see its `notes`.

## File format

```json
{
  "id": "c01",
  "split": "dev",
  "synthetic": true,
  "language": "en",
  "audio": true,
  "supported": true,
  "scenario": "one-line description",
  "turns": [ { "speaker": "Doctor", "text": "..." } ],
  "gold": [ { "category": "symptom", "turn": 5, "key": "no chest pain", "negated": true, "uncertain": false } ],
  "notes": "what is intentionally irrelevant, ambiguous or tricky"
}
```

- `turn` is the 0-based index into `turns`. `key` is a lowercase substring that occurs literally (case-insensitive) in that turn's text. One gold row per (category, key) per turn; a turn can have several rows.
- `negated: true` means the statement is a denial or absence ("no fever", "no known drug allergies" is `allergy` with key `allerg`). `uncertain: true` means the speaker hedged ("maybe", "I think", "probably", "could be") or the information is vague.
- Categories: chief_complaint, symptom, duration, past_medical_history, medication_history (patient takes or took), allergy, family_history, examination_finding, vital_sign (a measurement the doctor states aloud), clinician_assessment, plan, medication_mention (a medicine the doctor prescribes or advises), investigation_mention, patient_concern, follow_up, red_flag. Denied red flags ("no chest pain, no fainting") are `symptom` with `negated: true`, not `red_flag`.
- Deliberately unlabelled: small talk (traffic, weather, cricket, parking, waiting time), doctor questions, patient questions that are not worries, hypothetical safety-net advice ("if you see black stool again, come to the emergency"), and patient-reported readings (c03 home blood pressure). These are the "irrelevant" and "ambiguous" parts the extractor should not pick up or should flag as uncertain.
- English files use plain ASCII punctuation and speakable numbers and units (milligrams, twice a day) so a speech synthesiser can read them and the transcript can be compared word for word.

## Validating

```
node data/eval/consultations-v1/validate.mjs
```

Dependency-free Node script. It checks the schema above (categories, turn indices, speaker names, split values, c01 to c08 dev and the rest test, language, audio and supported flags, turn counts, ASCII text in English files, lowercase keys that occur literally in the turn, one chief_complaint per file, no duplicate rows), that doctor-side categories sit on Doctor turns and patient-side categories on Patient turns, and the coverage requirements for the English files. It prints a per-file summary and exits non-zero on any problem.

## Results and speech audio

- **Results** (committed): [`../results/extraction-v1.md`](../results/extraction-v1.md) (important points: development and held-out test split) and [`../results/stt-v1.md`](../results/stt-v1.md) (speech-to-text on synthetic speech), with their caveats in [`docs/safety/AI_MODELS.md`](../../../docs/safety/AI_MODELS.md). The held-out test split was run once for extraction after the rules were frozen. The speech evaluation also scored the rules on all English files (development and test together) to compare the script with the speech model's text; nothing was tuned after that.
- **Speech audio** (generated, not committed): `powershell -ExecutionPolicy Bypass -File data/eval/consultations-v1/synthesise-audio.ps1` reads the English files aloud with the offline Windows voices into `data/eval/audio/` (git-ignored); then `cd apps/api && npx tsx src/eval/stt.ts` with the local speech service running. The audio is clean synthetic speech, one voice at a time: it says nothing about real clinic audio.
