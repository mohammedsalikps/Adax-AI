Model: faster-whisper-small (faster-whisper 1.2.1 / ctranslate2 4.8.2, int8, weights sha256 3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671)

**Word error rate by turn (synthetic speech, per-turn audio)**

| Group | Turns | Reference words | WER | Sub / Del / Ins | Median turn WER | 90th pct turn WER | Exact turns |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| All English files | 302 | 4692 | 1.8% | 54 / 6 / 23 | 0.0% | 5.0% | 258 |
| dev split | 198 | 2915 | 1.7% | 32 / 6 / 12 | 0.0% | 5.0% | 169 |
| test split | 104 | 1777 | 1.9% | 22 / 0 / 11 | 0.0% | 5.4% | 89 |
| Doctor turns | 151 | 2599 | 1.4% | 22 / 6 / 8 | 0.0% | 4.0% | 132 |
| Patient turns | 151 | 2093 | 2.2% | 32 / 0 / 15 | 0.0% | 5.6% | 126 |
| Turns of 5 words or fewer | 46 | 177 | 0.6% | 1 / 0 / 0 | 0.0% | 0.0% | 45 |
| Turns of more than 5 words | 256 | 4515 | 1.8% | 53 / 6 / 23 | 0.0% | 5.6% | 213 |

**Language identification** (every script is English; the model was not given a language): English reported for 302 of 302 turns (100.0%); for turns of more than 5 words 256 of 256 (100.0%); for turns of 5 words or fewer 46 of 46 (100.0%). Turns with no text returned count as not English.
Turns where the model returned no text at all: 0 of 302.

**Speed** (CPU, int8, one request at a time, this machine): 2067 s of audio transcribed in 1441 s (real-time factor 0.70; below 1 is faster than real time). Median per-turn latency 4860 ms, 90th percentile 5867 ms.

**Important points found in the speech model's text, compared with the same rules on the script** (point matching as in the extraction evaluation; all English files, dev and test together)

| Input | Gold | Proposed | Matched | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Script text, speakers labelled | 346 | 324 | 261 | 81% | 75% | 78% |
| Speech model text, speakers labelled | 346 | 303 | 219 | 72% | 63% | 67% |
| Script text, speakers unlabelled | 346 | 268 | 204 | 76% | 59% | 66% |
| Speech model text, speakers unlabelled | 346 | 274 | 174 | 64% | 50% | 56% |

"Speakers labelled" is the best case (the real model identifies no speakers: the doctor assigns them, line by line); "unlabelled" is what the rules do when nobody has.

**Long recordings** (the whole consultation as one recording, 0.8 s of silence between turns; the model sees no turn boundaries)

| File | Audio | Time to transcribe | Segments | Session WER | Turn starts found | Median start error | 90th pct start error | Times ordered and inside the audio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| c01 | 161 s | 27 s | 44 | 0.6% | 24 of 24 | 175 ms | 4000 ms | yes |
| c09 | 207 s | 32 s | 59 | 1.4% | 26 of 26 | 2260 ms | 5085 ms | yes |
| c12 | 229 s | 29 s | 48 | 1.5% | 26 of 26 | 145 ms | 4925 ms | yes |

"Start error" compares the start of the first speech-model segment that overlaps a turn with the true start of that turn. A segment that covers two turns starts early for the second one; the model decides segment boundaries.
