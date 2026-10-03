# Models used by the capture pipeline: model cards and measured results

**Status: written 3 Oct 2026 for slice V2.** An engineering record, not a regulatory file. **Nothing here is a claim of clinical validity, diagnostic accuracy, regulatory approval or production readiness.** Every number below was measured on **synthetic** material (listed in [DATASETS.md](DATASETS.md)), by one author, on one machine, and says nothing reliable about real consultations. Read the limits before the numbers.

## 1. What runs, and where

| | Speech-to-text | Important-point extraction |
| --- | --- | --- |
| Component | `services/speech` (FastAPI) around `faster-whisper` | `apps/api/src/ai/extract/rules.ts` |
| Model | `Systran/faster-whisper-small`, revision `536b0662742c02347bc0e980a01041f333bce120`: OpenAI's open *Whisper small* weights, converted for CTranslate2 by SYSTRAN. **Run locally; nothing is sent to OpenAI, SYSTRAN or anyone** | None: fixed rules (lexicons, clause splitting, negation and hedge scope, durations, number words) |
| Licence | Model MIT; faster-whisper MIT; CTranslate2 MIT | Own code |
| Runtime | `faster-whisper 1.2.1`, `ctranslate2 4.8.2`, `av 16.0.1` (audio decoding, in memory), `onnxruntime 1.30.0` (voice-activity filter); CPU, `int8` | Node (the API) |
| Weights identity | `model.bin` SHA-256 `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671` (483,546,902 bytes); every transcription run stores it; files verified against [`models.lock.json`](../../services/speech/models.lock.json) when downloaded | Version string `extract-rules-v1`, stored on every point |
| Where | `127.0.0.1:8002` only; the API refuses a non-loopback address unless an operator allows it on purpose | In the API process |
| Data leaving the machine | **None** | **None** (a hosted extractor exists only if `ai.extraction.provider: llm` is set; it is not the default and is not evaluated here) |
| Default | Provider `none` until `SPEECH_PROVIDER=local` is set; there is **no hosted speech provider in the code** | `rules` |
| Download | `npm run speech:model` (about 486 MB from huggingface.co) after the owner approved name, source and size; PyPI packages about 70 MB | None |

## 2. Speech-to-text model card (`faster-whisper-small`)

- **Intended use here:** turn the doctor's recording of a consultation into draft text with times and a language label, for the doctor to read and correct. It is an aid to memory, not a record: the doctor reviews the transcript, assigns speakers, and confirms or rejects every important point.
- **Not intended for:** speaker identification (it does none), translation (never used: `task` is always `transcribe`), anything where a missed or invented word could harm without a person checking, real-time word-by-word captions, emergency use.
- **Languages:** the model is multilingual (about 99 languages, uneven quality). **This product supports English only**, because English is the only language whose transcription *and* extraction were measured. Other languages are transcribed if spoken, labelled with the detected language, and the extractor skips them and says so. **No Hindi, Tamil or code-mixed audio was evaluated**: the only text-to-speech voices on the machine are English (see §4), and recordings of real speakers do not exist in this repository. This is a gap, not a result.
- **Score:** each line carries `confidence = exp(mean token log-probability)` labelled `mean_token_probability`. It is the model's own certainty about the words it chose; it is **not calibrated** and not the chance that the line is right. Lines below 0.5 are marked "Low model score"; a line the model itself says is probably not speech (no-speech probability ≥ 0.9) and that scores below 0.5 is dropped rather than stored as speech.
- **Speed:** CPU only (this machine: a 4 GB RTX 2050 exists but is not used). A part is transcribed after it is recorded; see §4 for measured speed.
- **Protections of the service:** it listens on loopback only, answers only requests addressed to a loopback host name (a web page cannot reach it through a DNS name it controls), asks for a client header that a browser cannot send to another origin without a pre-flight the service never answers, keeps uploads in memory (the multipart parser is told not to spool to temporary files, and a guard in front of the application refuses a declared length over the limit and cuts a body off at the limit before anything is parsed; at most 4 requests, each up to about 65 MiB, are in memory at once), withholds exception messages and tracebacks from its logs, refuses to load weights that do not match the SHA-256 pinned in `models.lock.json`, and is started with an allow-listed environment (no database passwords or provider keys). Since V2.1 it also **judges an upload by its content** (only WebM, Ogg, WAV, MP3 or MP4/M4A by their first bytes; anything else is refused with 415), opens it with the one demuxer for that kind and an in-memory-only protocol whitelist (an upload cannot make it open a file or an address), **bounds the decoded length before the expensive work** (default 3,600 s) and caps pending requests (429). It has **no sign-in by design**: it is a localhost sidecar of one API process and is not reachable from other machines; any process on this computer can use it (a remote deployment would need a network boundary and real authentication that do not exist). Hostile audio is still decoded by unsandboxed FFmpeg (through PyAV) under the user's account: the controls limit that exposure, they do not remove it ([ADR 0015](../adr/0015-hosted-ai-egress-policy-and-speech-service-hardening.md)).
- **Known failure modes of this model family:** drug names and numbers that sound alike; dropped negations ("no" lost); invented text on silence or noise; language mis-detection on very short clips; the first call after start-up is slower (model load); long silence can cause repeated phrases (mitigated by the voice filter and by not conditioning on previous text, not eliminated).
- **Provenance and licence of training data:** as published by OpenAI for Whisper (large-scale weakly supervised web audio). We did not train, fine-tune or modify the model.

## 3. Important-point extractor model card (`extract-rules-v1`)

- **Intended use:** propose, from a transcript, *drafts* of the points a doctor would usually want to note, each tied to the lines it came from. Nothing it produces is part of the record until the doctor confirms it, and confirming does not write to the note.
- **How it works:** it matches words and phrases from lists, splits lines into clauses, reads who spoke from the speaker label (or guesses the side from "I/my" versus "you", and says so), keeps negation and hedging in scope (except contrast words such as "but", "just", "only"), reads durations and numbers said aloud, and copies the speaker's own words rather than paraphrasing. It does not know a drug, symptom or phrase that is not in its lists, and it does not understand context.
- **Language:** English only. Lines in another language or script, or detected by the speech model as not English, are skipped and counted, and the screen says so.
- **Not intended for:** diagnosis, triage, or any decision.
- **Known limits:** misses unlisted vocabulary; can propose a point from a sentence that is not about the patient (a relative's illness, a hypothetical); sorts some plan statements into the wrong one of plan, medication and investigation; red-flag phrases are matched by list. Hindi, Hinglish and other languages are out of scope.

## 4. Measured: speech-to-text on synthetic speech

**How:** the 12 English consultations of [`data/eval/consultations-v1`](../../data/eval/consultations-v1/README.md) (302 turns, 4,692 words) were read aloud by the three offline Windows text-to-speech voices that ship with this computer (David, Zira, Hazel; en-US and en-GB; one WAV per turn, 16 kHz mono) and sent to the real service through the same client the application uses. Full tables and the exact method: [`data/eval/results/stt-v1.md`](../../data/eval/results/stt-v1.md); reproduce with `synthesise-audio.ps1` and `npx tsx src/eval/stt.ts` (apps/api). Words are compared after a small fixed normalisation (case, punctuation, hyphens, number words read as digits, "mg" and "ml" spelled out) and nothing else is forgiven.

| Measure | Result |
| --- | --- |
| Word error rate, all English turns | **1.8 %** (54 substitutions, 6 deletions, 23 insertions in 4,692 words); 258 of 302 turns exactly right |
| Development files / test files | 1.7 % / 1.9 % |
| Doctor voice (David) / patient voices (Zira, Hazel) | 1.4 % / 2.2 % |
| Language identification (model given no hint; all scripts English) | English for **302 of 302** turns, including 46 turns of five words or fewer |
| Turns returned empty | 0 of 302 |
| Whole consultation as one recording (3 files, 161 to 229 s) | session word error rate 0.6 %, 1.4 %, 1.5 %; every turn start found; **times ordered and inside the audio in all three** |
| Start time of a turn, long recordings | median error 175 ms, 2,260 ms and 145 ms for the three files; 90th percentile 4.0 to 5.1 s (the model joins neighbouring turns into one segment, so the second turn's start is early) |
| Speed on this CPU | per-turn requests (avg. 6.8 s of audio): median 4.9 s, 90th percentile 5.9 s each, real-time factor 0.70 while other work ran on the machine; the three long recordings were transcribed at about 0.13 to 0.17 times real time. A 20-second part therefore appears roughly 3 to 7 seconds after it ends |

**Read these numbers for what they are.** Text-to-speech audio is clean, quiet, evenly paced, one voice at a time, with clear pronunciation and no accent, noise, overlap, interruption, distance from the microphone or emotion. A recognition model scores far better on it than on real clinic audio, where error rates several times higher are common for this kind of model and drug names, numbers and negations are the costly mistakes. **This is a sanity check that the pipeline works and the model is installed correctly, not an estimate of accuracy in a clinic.** It tells nothing about Indian-English accents, Hindi, Tamil or code-mixed speech, children, masks, a noisy room or a phone microphone.

## 5. Measured: important points

Full tables: [`data/eval/results/extraction-v1.md`](../../data/eval/results/extraction-v1.md). Single annotator (the same author who wrote the scripts), 15 scripted dialogues, one pass of labels; treat a difference of a few points as noise.

| Input | Gold points | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| **Development split** (written and tuned against), speakers labelled | 216 | 83 % | 89 % | 86 % |
| Development split, speakers unlabelled | 216 | 79 % | 69 % | 73 % |
| **Held-out test split, English** (4 files), speakers labelled | 130 | **75 %** | **53 %** | **62 %** |
| Held-out test split, English, speakers unlabelled | 130 | 69 % | 43 % | 53 % |
| Held-out test split, Hindi and Hinglish (3 files) | 60 | no points proposed: all lines skipped and counted | | |
| Rules on **the speech model's text** instead of the script (all 12 English files, dev and test together), speakers labelled | 346 | 72 % (script: 81 %) | 63 % (script: 75 %) | 67 % (script: 78 %) |
| Same, speakers unlabelled | 346 | 64 % (script: 76 %) | 50 % (script: 59 %) | 56 % (script: 66 %) |

- **The development and test numbers differ a lot.** The rules were written against the development files, so 89 % recall there is not what to expect elsewhere; **the held-out 53 % recall is the honest figure** for text the rules were not tuned on, and it shows the lists of words and patterns are the limit: they miss what they do not know (assessments, examination findings, past history phrased unusually, symptoms in other words).
- **Negation and hedging are kept** on the points that were matched (negation agreed on 99 to 100 %, hedging on 93 to 98 %), and **who said it** was right on 100 % of points when speakers were labelled and on 96 % (development) to 100 % (test) of the points the rules placed on a side when they were guessed from the wording. Points whose side was guessed are always flagged for explicit confirmation.
- **Transcription errors cost recall and precision:** feeding the rules the speech model's text instead of the script lowers recall from 75 % to 63 % even though the word error rate is 1.8 %, because one wrong word in a short clinical phrase is enough to miss a point or to match the wrong one.
- **Not measured:** the effect of the doctor's corrections; the part-boundary stitching (the evaluation text has no recording times); non-English text beyond declining it.

## 6. Speaker labels, languages, and what was not tested

- **Speaker identification:** none by any model. The extractor's *guess* of the side from the wording (used only when nobody assigned the line) was right for 96 to 100 % of the points it placed on a side, on scripted dialogue where doctors ask and patients answer in plain first and second person; real conversations are messier. The doctor's assignment is the reference.
- **Languages:** English only is supported and measured. **Hindi, Tamil and code-mixed audio were not evaluated** (no voice or recordings available without a download the owner did not approve). The Hindi and Hinglish *text* files only show that the extractor declines non-English text.
- **Not tested at all:** real recordings, real accents, noise and distance, overlapping speech, children, long (hours) recordings, the stethoscope and thermal pipelines (other slices).

## 7. Re-running and keeping this honest

`npm run speech:model` (once), `npm run dev:speech`, then from `apps/api`: `npx tsx src/eval/stt.ts --write-md ../../data/eval/results/stt-v1.md` after `synthesise-audio.ps1`; `npx tsx src/eval/cli.ts --split dev|test --lang en|all` for extraction. The unit tests keep floors a little under the measured extraction results (development and test split) and under nothing for speech (the real model is not run in the automated suite; the service has one optional real-model test). A change to the rules that is tuned on the test split makes it a development split: say so in this file.
