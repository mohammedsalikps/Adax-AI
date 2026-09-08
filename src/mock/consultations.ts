import type { Consultation } from '@/types/consultation'

/* ------------------------------------------------------------------
   Previously recorded consultations. Fictional demonstration data —
   not clinical guidance. New consultations are appended by the
   repository as they are saved.
------------------------------------------------------------------ */

export const SEED_CONSULTATIONS: Consultation[] = [
  {
    id: 'con_ri_2026_06_12',
    patientId: 'PT-2026-00142',
    doctorName: 'Dr Ananya Rao',
    status: 'completed',
    createdAt: '2026-06-12T10:35:00',
    updatedAt: '2026-06-12T10:52:00',
    chiefComplaint: 'Routine three-month diabetes review. Reports occasional tiredness.',
    historyOfPresentIllness:
      'Type 2 diabetes for eight years, on metformin twice daily. Adherent to medication. Diet has slipped over the past two months with frequent eating out. No polyuria, no visual disturbance. Walking has reduced since a knee strain in April.',
    examination:
      'Alert and comfortable. BP 146/90 mmHg seated. Peripheral pulses palpable. Foot examination normal, monofilament sensation intact bilaterally. No ulcers or callus.',
    clinicalNotes:
      'HbA1c risen from 7.6% to 8.2%. Discussed dietary pattern and the effect of reduced activity. Patient willing to restart daily walking.',
    diagnoses: [
      {
        id: 'dx_ri_1',
        name: 'Type 2 diabetes mellitus, suboptimal glycaemic control',
        notes: 'HbA1c 8.2%, target below 7.0%',
      },
      { id: 'dx_ri_2', name: 'Hypertension', notes: 'Above target on current therapy' },
    ],
    prescription: [
      {
        id: 'rx_ri_1',
        medication: 'Glycomet',
        genericName: 'Metformin',
        strength: '500 mg',
        dose: '1 tablet',
        frequency: 'BD',
        route: 'oral',
        duration: '3 months',
        quantity: '180 tablets',
        instructions: 'After food',
        enteredBy: 'doctor',
      },
      {
        id: 'rx_ri_2',
        medication: 'Telma',
        genericName: 'Telmisartan',
        strength: '40 mg',
        dose: '1 tablet',
        frequency: 'OD',
        route: 'oral',
        duration: '3 months',
        quantity: '90 tablets',
        instructions: 'Before food, morning',
        enteredBy: 'doctor',
      },
    ],
    followUp: {
      required: true,
      date: '2026-09-12',
      instructions: 'Repeat HbA1c and lipid profile one week before the visit.',
    },
  },
  {
    id: 'con_mn_2026_05_28',
    patientId: 'PT-2026-00118',
    doctorName: 'Dr Ananya Rao',
    status: 'completed',
    createdAt: '2026-05-28T15:20:00',
    updatedAt: '2026-05-28T15:41:00',
    chiefComplaint: 'Three headache episodes this month, each preceded by visual aura.',
    historyOfPresentIllness:
      'Episodes last four to six hours, unilateral, throbbing, with photophobia. Aura consists of zigzag lines lasting about twenty minutes. Triggers uncertain; possible association with disrupted sleep and skipped meals.',
    examination:
      'Neurological examination normal. Fundi normal. No neck stiffness. BP 112/74 mmHg.',
    clinicalNotes:
      'Advised a headache diary recording sleep, meals and onset. Prophylaxis discussed but deferred until the diary is reviewed.',
    diagnoses: [{ id: 'dx_mn_1', name: 'Migraine with aura' }],
    prescription: [],
    followUp: {
      required: true,
      date: '2026-08-28',
      instructions: 'Bring the completed headache diary.',
    },
  },
]
