# Datasets and their provenance

**Status: started 3 Oct 2026.** One entry per dataset used in development, demonstration or testing. Nothing in this repository comes from a real patient, and **no external dataset is used**: before one is, its licence, permitted use, source, preprocessing and de-identification must be verified and written here.

## Synthetic hospital dataset v1 (`npm run demo:hospital`)

| | |
| --- | --- |
| What | 12 fictional patients across general medicine, paediatrics and orthopaedics, 2 extra staff accounts (an orthopaedics doctor, a paediatrics nurse), and for each patient allergies, conditions, medicines (one stopped), investigation results, earlier signed consultations (1 to 3, with vitals, notes, diagnoses and prescriptions) and today's activity (appointments, a queue in every state) |
| Origin | Written by hand for this project in `apps/api/src/db/hospital-seed-data.ts`. Names, dates, values and histories are invented. No real person, no copied record, no scraped or downloaded data, no model-generated text |
| Marking | Every history entry and every patient made by it carries `data_origin = synthetic`; the staff names and the facility say "(synthetic)"; the product shows a "synthetic data only" banner and a "Synthetic" tag on the patient. The seed **refuses to run** unless all of these hold: the deployment is not production, its `DATA_ORIGIN` is `synthetic`, the facility name ends in "(synthetic)", and no patient in the database is marked `clinical`. Its patients' telephone numbers are from a range no mobile operator issues (they start with 5), so no message could reach a real person |
| Dates | Relative to the day it runs (histories always look recent). Earlier consultations are signed with a historical date by holding the clock the API reads for the one signing request; they verify as untouched. The audit log shows the day the seed ran |
| Medical content | Ordinary, conservative examples (for example metformin 500 mg twice daily, HbA1c 7.2 %, an iron-deficiency picture with a low ferritin). **It is not clinical guidance, not a validated case set, and was not reviewed by a clinician.** A test checks that no medicine in a patient's history is one that patient is recorded as allergic to, **by name and by drug class** (for example a penicillin allergy also excludes amoxicillin) |
| Use | Demonstration, interface testing and the automated tests of the history model. **Not a training set and not an evaluation set**: 12 hand-written patients are far too few and too uniform to say anything about a model's performance |
| Splits, metrics, failure cases | Not applicable (no model is trained or evaluated on it). The AI evaluation set planned for slice V2 will be a separate dataset with its own entry here |
| Gaps against the target list | Not yet in the dataset: device readings, thermal studies, stethoscope recordings, transcripts, AI outputs, a portal account for any patient, more than one facility |
| Re-running | Idempotent and resumable: a patient is recognised by **full name and date of birth** (not by phone number) and is never made twice; each step of a patient's history (consent, allergy, condition, medicine, result, earlier consultation) is done only if it is not already there, so a run that stopped half way is completed by the next one; today's activity is added once per day. Dates and times are changed directly in the database only inside one transaction with the trigger-skipping setting scoped to it |

## Test fixtures

Tests create their own throw-away synthetic patients, staff and records and delete nothing outside the disposable test and end-to-end databases. The thermal tests use public FLIR sample images fetched by `scripts/fetch-thermal-samples.mjs` (git-ignored; tests skip without them); their source and licence (MIT, National Drones) are recorded by the fetch script and in `samples/thermal/SOURCE.txt`, and they are third-party images, not clinic data.
