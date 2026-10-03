# Important-point extraction: measured results (rules `extract-rules-v1`)

Measured 3 Oct 2026 on the **synthetic** consultation set `data/eval/consultations-v1` (single author, hand-labelled, see its README). **Not clinical validation.** Reproduce with `cd apps/api && npx tsx src/eval/cli.ts --split dev|test --lang en|all`.

- **Development split (c01 to c08):** the rules were written and tuned against these files. These numbers are optimistic by construction.
- **Held-out test split (c09 to c12, h01, h02, x01):** not looked at while the rules were written; run once after the rules were frozen. **This is the number to believe, and it is much lower than the development one.** (The speech evaluation, `stt-v1.md`, also scored the rules on all English files, development and test together, to compare the script with the speech model's text; nothing was tuned after that.)
- "Speakers labelled" is the best case (a speaker label on every line). "Speakers unlabelled" is what the rules do when nobody has assigned speakers (the real speech model identifies none): who said a line is then guessed from the wording, and every point whose side was guessed is flagged for the doctor's explicit confirmation.
- A point matches a gold row when it has the same category, comes from the same turn, and its words contain the gold phrase. One-to-one matching.

## Development split (English)

**dev split, en, speakers labelled** (8 files, 216 gold points, 232 proposed points)

| Category | Gold | Proposed | Matched | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allergy | 8 | 7 | 7 | 100% | 88% | 93% |
| chief_complaint | 8 | 8 | 7 | 88% | 88% | 88% |
| clinician_assessment | 12 | 9 | 9 | 100% | 75% | 86% |
| duration | 9 | 11 | 8 | 73% | 89% | 80% |
| examination_finding | 18 | 21 | 16 | 76% | 89% | 82% |
| family_history | 6 | 6 | 6 | 100% | 100% | 100% |
| follow_up | 11 | 11 | 10 | 91% | 91% | 91% |
| investigation_mention | 18 | 19 | 17 | 89% | 94% | 92% |
| medication_history | 12 | 12 | 11 | 92% | 92% | 92% |
| medication_mention | 18 | 17 | 14 | 82% | 78% | 80% |
| past_medical_history | 6 | 8 | 6 | 75% | 100% | 86% |
| patient_concern | 10 | 12 | 9 | 75% | 90% | 82% |
| plan | 27 | 35 | 24 | 69% | 89% | 77% |
| red_flag | 1 | 1 | 0 | 0% | 0% | – |
| symptom | 37 | 40 | 33 | 83% | 89% | 86% |
| vital_sign | 15 | 15 | 15 | 100% | 100% | 100% |
| **All** | 216 | 232 | 192 | 83% | 89% | 86% |

Of the matched points: negation agreed on 99%, hedging agreed on 98%; who said it (patient or doctor) was right on 100% of the 192 points placed on a side.

**dev split, en, speakers unlabelled** (8 files, 216 gold points, 187 proposed points)

| Category | Gold | Proposed | Matched | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allergy | 8 | 8 | 7 | 88% | 88% | 88% |
| chief_complaint | 8 | 8 | 7 | 88% | 88% | 88% |
| clinician_assessment | 12 | 1 | 1 | 100% | 8% | 15% |
| duration | 9 | 12 | 8 | 67% | 89% | 76% |
| examination_finding | 18 | 3 | 3 | 100% | 17% | 29% |
| family_history | 6 | 6 | 6 | 100% | 100% | 100% |
| follow_up | 11 | 6 | 6 | 100% | 55% | 71% |
| investigation_mention | 18 | 19 | 17 | 89% | 94% | 92% |
| medication_history | 12 | 7 | 5 | 71% | 42% | 53% |
| medication_mention | 18 | 8 | 7 | 88% | 39% | 54% |
| past_medical_history | 6 | 9 | 6 | 67% | 100% | 80% |
| patient_concern | 10 | 12 | 9 | 75% | 90% | 82% |
| plan | 27 | 34 | 22 | 65% | 81% | 72% |
| red_flag | 1 | 1 | 0 | 0% | 0% | – |
| symptom | 37 | 41 | 32 | 78% | 86% | 82% |
| vital_sign | 15 | 12 | 12 | 100% | 80% | 89% |
| **All** | 216 | 187 | 148 | 79% | 69% | 73% |

Of the matched points: negation agreed on 99%, hedging agreed on 99%; who said it (patient or doctor) was right on 96% of the 96 points placed on a side.


## Held-out test split (English)

**test split, en, speakers labelled** (4 files, 130 gold points, 92 proposed points)

| Category | Gold | Proposed | Matched | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allergy | 4 | 3 | 2 | 67% | 50% | 57% |
| chief_complaint | 4 | 3 | 3 | 100% | 75% | 86% |
| clinician_assessment | 8 | 1 | 1 | 100% | 13% | 22% |
| duration | 5 | 6 | 1 | 17% | 20% | 18% |
| examination_finding | 11 | 4 | 3 | 75% | 27% | 40% |
| family_history | 5 | 2 | 2 | 100% | 40% | 57% |
| follow_up | 4 | 4 | 4 | 100% | 100% | 100% |
| investigation_mention | 9 | 9 | 5 | 56% | 56% | 56% |
| medication_history | 11 | 12 | 11 | 92% | 100% | 96% |
| medication_mention | 9 | 10 | 8 | 80% | 89% | 84% |
| past_medical_history | 8 | 2 | 2 | 100% | 25% | 40% |
| patient_concern | 4 | 3 | 2 | 67% | 50% | 57% |
| plan | 13 | 12 | 7 | 58% | 54% | 56% |
| red_flag | 3 | 1 | 0 | 0% | 0% | – |
| symptom | 22 | 11 | 9 | 82% | 41% | 55% |
| vital_sign | 10 | 9 | 9 | 100% | 90% | 95% |
| **All** | 130 | 92 | 69 | 75% | 53% | 62% |

Of the matched points: negation agreed on 100%, hedging agreed on 94%; who said it (patient or doctor) was right on 100% of the 69 points placed on a side.

**test split, en, speakers unlabelled** (4 files, 130 gold points, 81 proposed points)

| Category | Gold | Proposed | Matched | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allergy | 4 | 5 | 2 | 40% | 50% | 44% |
| chief_complaint | 4 | 4 | 3 | 75% | 75% | 75% |
| clinician_assessment | 8 | 0 | 0 | – | 0% | – |
| duration | 5 | 6 | 1 | 17% | 20% | 18% |
| examination_finding | 11 | 2 | 1 | 50% | 9% | 15% |
| family_history | 5 | 2 | 2 | 100% | 40% | 57% |
| follow_up | 4 | 3 | 3 | 100% | 75% | 86% |
| investigation_mention | 9 | 9 | 5 | 56% | 56% | 56% |
| medication_history | 11 | 10 | 7 | 70% | 64% | 67% |
| medication_mention | 9 | 4 | 3 | 75% | 33% | 46% |
| past_medical_history | 8 | 2 | 2 | 100% | 25% | 40% |
| patient_concern | 4 | 3 | 2 | 67% | 50% | 57% |
| plan | 13 | 10 | 7 | 70% | 54% | 61% |
| red_flag | 3 | 1 | 0 | 0% | 0% | – |
| symptom | 22 | 11 | 9 | 82% | 41% | 55% |
| vital_sign | 10 | 9 | 9 | 100% | 90% | 95% |
| **All** | 130 | 81 | 56 | 69% | 43% | 53% |

Of the matched points: negation agreed on 100%, hedging agreed on 93%; who said it (patient or doctor) was right on 100% of the 37 points placed on a side.


## Held-out test split including the three non-English files (Hindi, Hinglish)

The rules read English only. For these three files nothing is proposed (all lines are skipped and counted on screen), so every gold row there is a miss; that is the intended behaviour for an unsupported language, not a quality result.

**test split, all, speakers labelled** (7 files, 190 gold points, 92 proposed points)

| Category | Gold | Proposed | Matched | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allergy | 7 | 3 | 2 | 67% | 29% | 40% |
| chief_complaint | 7 | 3 | 3 | 100% | 43% | 60% |
| clinician_assessment | 12 | 1 | 1 | 100% | 8% | 15% |
| duration | 9 | 6 | 1 | 17% | 11% | 13% |
| examination_finding | 18 | 4 | 3 | 75% | 17% | 27% |
| family_history | 6 | 2 | 2 | 100% | 33% | 50% |
| follow_up | 7 | 4 | 4 | 100% | 57% | 73% |
| investigation_mention | 12 | 9 | 5 | 56% | 42% | 48% |
| medication_history | 15 | 12 | 11 | 92% | 73% | 81% |
| medication_mention | 13 | 10 | 8 | 80% | 62% | 70% |
| past_medical_history | 10 | 2 | 2 | 100% | 20% | 33% |
| patient_concern | 7 | 3 | 2 | 67% | 29% | 40% |
| plan | 17 | 12 | 7 | 58% | 41% | 48% |
| red_flag | 3 | 1 | 0 | 0% | 0% | – |
| symptom | 33 | 11 | 9 | 82% | 27% | 41% |
| vital_sign | 14 | 9 | 9 | 100% | 64% | 78% |
| **All** | 190 | 92 | 69 | 75% | 36% | 49% |

Of the matched points: negation agreed on 100%, hedging agreed on 94%; who said it (patient or doctor) was right on 100% of the 69 points placed on a side.

**test split, all, speakers unlabelled** (7 files, 190 gold points, 81 proposed points)

| Category | Gold | Proposed | Matched | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allergy | 7 | 5 | 2 | 40% | 29% | 33% |
| chief_complaint | 7 | 4 | 3 | 75% | 43% | 55% |
| clinician_assessment | 12 | 0 | 0 | – | 0% | – |
| duration | 9 | 6 | 1 | 17% | 11% | 13% |
| examination_finding | 18 | 2 | 1 | 50% | 6% | 10% |
| family_history | 6 | 2 | 2 | 100% | 33% | 50% |
| follow_up | 7 | 3 | 3 | 100% | 43% | 60% |
| investigation_mention | 12 | 9 | 5 | 56% | 42% | 48% |
| medication_history | 15 | 10 | 7 | 70% | 47% | 56% |
| medication_mention | 13 | 4 | 3 | 75% | 23% | 35% |
| past_medical_history | 10 | 2 | 2 | 100% | 20% | 33% |
| patient_concern | 7 | 3 | 2 | 67% | 29% | 40% |
| plan | 17 | 10 | 7 | 70% | 41% | 52% |
| red_flag | 3 | 1 | 0 | 0% | 0% | – |
| symptom | 33 | 11 | 9 | 82% | 27% | 41% |
| vital_sign | 14 | 9 | 9 | 100% | 64% | 78% |
| **All** | 190 | 81 | 56 | 69% | 29% | 41% |

Of the matched points: negation agreed on 100%, hedging agreed on 93%; who said it (patient or doctor) was right on 100% of the 37 points placed on a side.

