import type { PastVisit } from '@/types/consultation'

/** Completed encounters shown in the Past History panel. Fictional. */
export const SEED_VISITS: PastVisit[] = [
  {
    id: 'vis_ri_003',
    patientId: 'PT-2026-00142',
    visitedOn: '2026-06-12',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Routine diabetes review',
    diagnosis: 'Type 2 diabetes mellitus, suboptimal control',
    summary:
      'HbA1c 8.2%, up from 7.6% in March. Metformin continued at 500 mg twice daily. Advised dietary review and daily walking. Foot examination normal.',
  },
  {
    id: 'vis_ri_002',
    patientId: 'PT-2026-00142',
    visitedOn: '2026-03-08',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Follow-up, blood pressure check',
    diagnosis: 'Hypertension, controlled',
    summary:
      'BP 132/84 mmHg. Telmisartan 40 mg once daily continued. HbA1c 7.6%. Lipid profile within target.',
  },
  {
    id: 'vis_ri_001',
    patientId: 'PT-2026-00142',
    visitedOn: '2025-11-15',
    doctorName: 'Dr Prakash Menon',
    chiefComplaint: 'Persistent cough for two weeks',
    diagnosis: 'Acute bronchitis',
    summary:
      'Chest clear on auscultation after treatment. Symptomatic management advised. Penicillin allergy noted — azithromycin prescribed instead.',
  },
  {
    id: 'vis_mn_002',
    patientId: 'PT-2026-00118',
    visitedOn: '2026-05-28',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Recurrent headache, three episodes this month',
    diagnosis: 'Migraine with aura',
    summary:
      'Episodes preceded by visual aura, lasting 4–6 hours. Trigger diary advised. Prophylaxis discussed but deferred pending diary review.',
  },
  {
    id: 'vis_mn_001',
    patientId: 'PT-2026-00118',
    visitedOn: '2026-01-14',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Annual health check',
    diagnosis: 'No acute illness',
    summary: 'Routine screening within normal limits. Haemoglobin 12.4 g/dL.',
  },
  {
    id: 'vis_ad_002',
    patientId: 'PT-2026-00097',
    visitedOn: '2026-08-19',
    doctorName: 'Dr Prakash Menon',
    chiefComplaint: 'Post-operative review, right knee',
    diagnosis: 'Recovering after arthroscopy',
    summary:
      'Wound healed. Range of movement improving. Physiotherapy continued for six weeks.',
  },
  {
    id: 'vis_ad_001',
    patientId: 'PT-2026-00097',
    visitedOn: '2026-05-02',
    doctorName: 'Dr Prakash Menon',
    chiefComplaint: 'Right knee pain on climbing stairs',
    diagnosis: 'Osteoarthritis, right knee',
    summary: 'X-ray showed joint space narrowing. Referred for arthroscopy.',
  },
  {
    id: 'vis_fs_001',
    patientId: 'PT-2026-00156',
    visitedOn: '2026-07-30',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Breathlessness at night',
    diagnosis: 'Bronchial asthma, mild persistent',
    summary:
      'Peak flow 82% of predicted. Inhaler technique reviewed and corrected. Preventer inhaler continued.',
  },
  {
    id: 'vis_vs_001',
    patientId: 'PT-2026-00163',
    visitedOn: '2026-08-25',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Chest discomfort on exertion',
    diagnosis: 'Stable angina',
    summary:
      'ECG unchanged from previous. Statin dose increased. Stress test scheduled.',
  },
  {
    id: 'vis_ak_001',
    patientId: 'PT-2026-00171',
    visitedOn: '2026-04-06',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Tiredness and hair fall',
    diagnosis: 'Iron deficiency anaemia',
    summary: 'Haemoglobin 9.8 g/dL, ferritin low. Oral iron started for three months.',
  },
  {
    id: 'vis_jm_001',
    patientId: 'PT-2026-00184',
    visitedOn: '2026-03-19',
    doctorName: 'Dr Prakash Menon',
    chiefComplaint: 'Daytime sleepiness, loud snoring',
    diagnosis: 'Obstructive sleep apnoea',
    summary: 'Sleep study confirmed moderate OSA. CPAP trial commenced.',
  },
  {
    id: 'vis_su_001',
    patientId: 'PT-2026-00190',
    visitedOn: '2026-08-02',
    doctorName: 'Dr Ananya Rao',
    chiefComplaint: 'Thyroid review',
    diagnosis: 'Hypothyroidism, adequately replaced',
    summary: 'TSH 3.1 mIU/L. Levothyroxine 75 mcg once daily continued.',
  },
]
