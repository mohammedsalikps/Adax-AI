// SYNTHETIC hospital dataset v1 (docs/DOCTOR_APP_PLAN.md, slice V1). Every person, history and result here is fictional,
// made up for development and demonstration, and is marked synthetic in the data (data_origin) and by the product's banner.
// Medicines, doses and results are ordinary, conservative examples, not clinical guidance. Dates are relative to the day the
// seed runs, so the histories always look recent. Nothing here comes from any real record or any external dataset.

export type Dept = 'GEN' | 'PED' | 'ORTH'
export type Vital = { kind: 'temperature' | 'heart_rate' | 'respiratory_rate' | 'systolic_bp' | 'diastolic_bp' | 'spo2' | 'blood_glucose' | 'pain_score' | 'weight' | 'height'; value: number }

export interface PastConsultation {
  /** How many days before the day the seed runs the visit was. */
  daysAgo: number
  complaint: string
  vitals: Vital[]
  history: string
  pastHistory?: string
  examination: string
  assessment: string
  plan: string
  followUp: string
  diagnoses: { description: string; code: string; kind?: 'primary' | 'secondary' | 'provisional' }[]
  prescription: { drugName: string; strength: string; form: string; dose: string; route?: string; frequency: string; duration: string; instructions?: string }[]
}

export type TodayState = 'booked' | 'no_show' | 'waiting' | 'in_triage' | 'ready' | 'in_consultation' | 'completed'

export interface TodaySpec {
  /** The appointment's time as minutes from the moment the seed runs, on the clinic's clock (negative: earlier today); absent for a walk-in. */
  atOffsetMin?: number
  state: TodayState
  complaint: string
  vitals?: Vital[]
  /** For in_consultation and completed: the doctor's note so far. */
  note?: Partial<Pick<PastConsultation, 'history' | 'examination' | 'assessment' | 'plan' | 'followUp'>>
  diagnoses?: PastConsultation['diagnoses']
  prescription?: PastConsultation['prescription']
}

export interface PatientSpec {
  key: string
  givenName: string
  familyName: string
  dateOfBirth: string
  sex: 'male' | 'female'
  /** Ten digits, from a range no mobile operator issues (it starts with 5), so no message could ever reach a real person. The seed recognises its patients by name and date of birth. */
  phone: string
  city: string
  bloodGroup?: string
  language?: string
  department: Dept
  allergies: { substance: string; reaction: string; severity: 'mild' | 'moderate' | 'severe' }[]
  noKnownAllergies?: boolean
  consents: ('data_processing' | 'ai_recording' | 'ai_record_assistant' | 'device_monitoring' | 'thermal_imaging')[]
  conditions: { name: string; code: string; sinceYear: number; sinceMonth?: number; status?: 'active' | 'controlled' | 'resolved'; note?: string }[]
  medications: { drugName: string; strength?: string; form?: string; dose: string; route?: string; frequency: string; startedOn?: string; reason?: string; stopped?: { on: string; reason: string } }[]
  results: { testName: string; valueText: string; valueNumber?: number; unit?: string; refLow?: number; refHigh?: number; refText?: string; interpretation?: 'normal' | 'abnormal'; daysAgo: number; note?: string }[]
  past: PastConsultation[]
  today?: TodaySpec
}

/** Extra staff for the synthetic hospital (the base seed has admin, dr.meera, dr.rahul and nurse.anil). Same demo password. */
export const HOSPITAL_STAFF = [
  { username: 'dr.arjun', fullName: 'Dr. Arjun Pillai (synthetic)', role: 'doctor', department: 'ORTH', registrationNumber: 'DEMO-REG-0003' },
  { username: 'nurse.divya', fullName: 'Divya Nair (synthetic)', role: 'nurse', department: 'PED', registrationNumber: null },
] as const

export const DOCTOR_FOR: Record<Dept, string> = { GEN: 'dr.meera', PED: 'dr.rahul', ORTH: 'dr.arjun' }

export const PATIENTS: PatientSpec[] = [
  {
    key: 'mohammed',
    givenName: 'Mohammed',
    familyName: 'Ali',
    dateOfBirth: '1972-05-21',
    sex: 'male',
    phone: '5000100001',
    city: 'Chennai',
    bloodGroup: 'B+',
    language: 'Tamil',
    department: 'GEN',
    allergies: [{ substance: 'Penicillin', reaction: 'Rash, breathing difficulty', severity: 'severe' }],
    consents: ['data_processing', 'ai_recording', 'ai_record_assistant', 'device_monitoring'],
    conditions: [
      { name: 'Type 2 diabetes mellitus', code: 'E11.9', sinceYear: 2019, sinceMonth: 3 },
      { name: 'Hypertension', code: 'I10', sinceYear: 2018, sinceMonth: 6, status: 'controlled' },
      { name: 'Dyslipidaemia', code: 'E78.5', sinceYear: 2020, sinceMonth: 8 },
    ],
    medications: [
      { drugName: 'Metformin', strength: '500 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', startedOn: '2019-03-20', reason: 'Type 2 diabetes' },
      { drugName: 'Amlodipine', strength: '5 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startedOn: '2018-06-12', reason: 'Hypertension' },
      { drugName: 'Atorvastatin', strength: '10 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily at night', startedOn: '2020-08-05', reason: 'Dyslipidaemia' },
      { drugName: 'Glimepiride', strength: '1 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startedOn: '2021-02-01', reason: 'Type 2 diabetes', stopped: { on: '2022-01-15', reason: 'Episodes of low blood sugar' } },
    ],
    results: [
      { testName: 'HbA1c', valueText: '7.2', valueNumber: 7.2, unit: '%', refLow: 4, refHigh: 5.6, daysAgo: 38, note: 'Laboratory reference range for people without diabetes' },
      { testName: 'Fasting glucose', valueText: '138', valueNumber: 138, unit: 'mg/dL', refLow: 70, refHigh: 99, daysAgo: 38 },
      { testName: 'LDL cholesterol', valueText: '118', valueNumber: 118, unit: 'mg/dL', refHigh: 100, daysAgo: 38 },
      { testName: 'Serum creatinine', valueText: '0.9', valueNumber: 0.9, unit: 'mg/dL', refLow: 0.7, refHigh: 1.3, daysAgo: 38 },
      { testName: 'HbA1c', valueText: '7.6', valueNumber: 7.6, unit: '%', refLow: 4, refHigh: 5.6, daysAgo: 215 },
    ],
    past: [
      {
        daysAgo: 395,
        complaint: 'Routine diabetes and blood pressure review',
        vitals: [{ kind: 'systolic_bp', value: 138 }, { kind: 'diastolic_bp', value: 88 }, { kind: 'heart_rate', value: 76 }, { kind: 'blood_glucose', value: 168 }],
        history: 'Type 2 diabetes for 5 years and hypertension for 6 years on regular treatment. No chest pain or breathlessness. No hypoglycaemic episodes since glimepiride was stopped.',
        pastHistory: 'Type 2 diabetes (2019), hypertension (2018), dyslipidaemia (2020). Penicillin allergy: rash and breathing difficulty.',
        examination: 'Well. BP 138/88. Pulse 76 regular. No pedal oedema.',
        assessment: 'Type 2 diabetes with fair control. Hypertension, borderline control.',
        plan: 'Continue metformin, amlodipine and atorvastatin. Diet and walking advice. HbA1c, lipids and creatinine before next visit.',
        followUp: 'Review in 6 months with reports.',
        diagnoses: [{ description: 'Type 2 diabetes mellitus without complications', code: 'E11.9' }, { description: 'Essential hypertension', code: 'I10', kind: 'secondary' }],
        prescription: [
          { drugName: 'Metformin', strength: '500 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Twice daily', duration: '90 days', instructions: 'After food' },
          { drugName: 'Amlodipine', strength: '5 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily', duration: '90 days' },
          { drugName: 'Atorvastatin', strength: '10 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily at night', duration: '90 days' },
        ],
      },
      {
        daysAgo: 215,
        complaint: 'Review with blood reports',
        vitals: [{ kind: 'systolic_bp', value: 132 }, { kind: 'diastolic_bp', value: 84 }, { kind: 'heart_rate', value: 74 }],
        history: 'Taking medicines regularly. Occasional tiredness in the evenings. No visual symptoms.',
        examination: 'Well. BP 132/84.',
        assessment: 'Type 2 diabetes, HbA1c 7.6 percent. Hypertension controlled.',
        plan: 'Continue current medicines. Reinforce diet. Repeat HbA1c in 3 to 4 months.',
        followUp: 'Review in 3 months.',
        diagnoses: [{ description: 'Type 2 diabetes mellitus without complications', code: 'E11.9' }],
        prescription: [{ drugName: 'Metformin', strength: '500 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Twice daily', duration: '90 days', instructions: 'After food' }],
      },
      {
        daysAgo: 38,
        complaint: 'Diabetes follow-up, repeat tests',
        vitals: [{ kind: 'systolic_bp', value: 130 }, { kind: 'diastolic_bp', value: 82 }, { kind: 'heart_rate', value: 78 }, { kind: 'blood_glucose', value: 150 }],
        history: 'Feels well. Walking 30 minutes most days. No new symptoms.',
        examination: 'Well. BP 130/82. Feet: sensation intact, no ulcers.',
        assessment: 'Type 2 diabetes, HbA1c 7.2 percent, improving. LDL above target.',
        plan: 'Continue metformin and amlodipine. Continue atorvastatin 10 mg; recheck lipids in 3 months. Diet advice.',
        followUp: 'Review in 3 months.',
        diagnoses: [{ description: 'Type 2 diabetes mellitus without complications', code: 'E11.9' }, { description: 'Dyslipidaemia', code: 'E78.5', kind: 'secondary' }],
        prescription: [
          { drugName: 'Metformin', strength: '500 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Twice daily', duration: '90 days', instructions: 'After food' },
          { drugName: 'Atorvastatin', strength: '10 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily at night', duration: '90 days' },
        ],
      },
    ],
    today: {
      atOffsetMin: -60,
      state: 'in_consultation',
      complaint: 'Diabetes follow-up; occasional blurred vision for two weeks',
      vitals: [{ kind: 'temperature', value: 36.8 }, { kind: 'heart_rate', value: 78 }, { kind: 'systolic_bp', value: 128 }, { kind: 'diastolic_bp', value: 82 }, { kind: 'spo2', value: 98 }, { kind: 'blood_glucose', value: 176 }],
      note: { history: 'Blurred vision on and off for two weeks, worse in the evening. No pain or redness of the eyes. Taking medicines regularly.' },
    },
  },
  {
    key: 'ravi',
    givenName: 'Ravi',
    familyName: 'Kumar',
    dateOfBirth: '1981-02-14',
    sex: 'male',
    phone: '5000100002',
    city: 'Chennai',
    bloodGroup: 'O+',
    language: 'Hindi',
    department: 'GEN',
    allergies: [{ substance: 'Sulfonamide antibiotics', reaction: 'Rash', severity: 'mild' }],
    consents: ['data_processing', 'ai_recording'],
    conditions: [
      { name: 'Type 2 diabetes mellitus', code: 'E11.9', sinceYear: 2022, sinceMonth: 9 },
      { name: 'Hypertension', code: 'I10', sinceYear: 2021 },
    ],
    medications: [
      { drugName: 'Metformin', strength: '500 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', startedOn: '2022-09-20', reason: 'Type 2 diabetes' },
      { drugName: 'Telmisartan', strength: '40 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startedOn: '2021-04-10', reason: 'Hypertension' },
    ],
    results: [
      { testName: 'HbA1c', valueText: '6.9', valueNumber: 6.9, unit: '%', refLow: 4, refHigh: 5.6, daysAgo: 52 },
      { testName: 'Serum creatinine', valueText: '1.0', valueNumber: 1.0, unit: 'mg/dL', refLow: 0.7, refHigh: 1.3, daysAgo: 52 },
    ],
    past: [
      {
        daysAgo: 52,
        complaint: 'Diabetes and blood pressure follow-up',
        vitals: [{ kind: 'systolic_bp', value: 134 }, { kind: 'diastolic_bp', value: 86 }, { kind: 'heart_rate', value: 80 }, { kind: 'weight', value: 82 }],
        history: 'No complaints. Takes medicines regularly. Works long hours, limited exercise.',
        examination: 'Well. BP 134/86.',
        assessment: 'Type 2 diabetes, HbA1c 6.9 percent. Hypertension, mildly above target.',
        plan: 'Continue metformin and telmisartan. Exercise and weight advice. Home BP readings.',
        followUp: 'Review in 2 months with home BP log.',
        diagnoses: [{ description: 'Type 2 diabetes mellitus without complications', code: 'E11.9' }, { description: 'Essential hypertension', code: 'I10', kind: 'secondary' }],
        prescription: [
          { drugName: 'Metformin', strength: '500 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Twice daily', duration: '60 days', instructions: 'After food' },
          { drugName: 'Telmisartan', strength: '40 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily', duration: '60 days' },
        ],
      },
    ],
    today: { atOffsetMin: -120, state: 'waiting', complaint: 'Follow-up; home blood pressure readings 140 over 90' },
  },
  {
    key: 'asha',
    givenName: 'Asha',
    familyName: 'Patel',
    dateOfBirth: '1994-07-09',
    sex: 'female',
    phone: '5000100003',
    city: 'Chennai',
    language: 'Gujarati',
    department: 'GEN',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing', 'ai_recording', 'ai_record_assistant'],
    conditions: [{ name: 'Allergic rhinitis', code: 'J30.9', sinceYear: 2015 }],
    medications: [{ drugName: 'Cetirizine', strength: '10 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily when needed', startedOn: '2019-03-01', reason: 'Allergic rhinitis' }],
    results: [{ testName: 'Haemoglobin', valueText: '12.9', valueNumber: 12.9, unit: 'g/dL', refLow: 12, refHigh: 15.5, daysAgo: 260 }],
    past: [
      {
        daysAgo: 260,
        complaint: 'Sore throat and runny nose',
        vitals: [{ kind: 'temperature', value: 37.4 }, { kind: 'heart_rate', value: 84 }, { kind: 'spo2', value: 99 }],
        history: 'Three days of sore throat, runny nose and mild cough. No breathlessness.',
        examination: 'Throat mildly congested. Chest clear.',
        assessment: 'Acute upper respiratory tract infection, likely viral.',
        plan: 'Symptomatic treatment, warm fluids, rest. Return if fever persists beyond 3 days.',
        followUp: 'Review if not improving.',
        diagnoses: [{ description: 'Acute upper respiratory infection', code: 'J06.9' }],
        prescription: [{ drugName: 'Paracetamol', strength: '500 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Up to three times daily when needed', duration: '3 days', instructions: 'After food' }],
      },
    ],
    today: {
      atOffsetMin: -90,
      state: 'ready',
      complaint: 'Fever and cough for 3 days, chest pain when coughing',
      vitals: [{ kind: 'temperature', value: 38.4 }, { kind: 'heart_rate', value: 98 }, { kind: 'respiratory_rate', value: 20 }, { kind: 'systolic_bp', value: 118 }, { kind: 'diastolic_bp', value: 76 }, { kind: 'spo2', value: 96 }],
    },
  },
  {
    key: 'priya',
    givenName: 'Priya',
    familyName: 'Singh',
    dateOfBirth: '1998-01-30',
    sex: 'female',
    phone: '5000100004',
    city: 'Chennai',
    department: 'GEN',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing'],
    conditions: [{ name: 'Iron deficiency anaemia', code: 'D50.9', sinceYear: 2026, sinceMonth: 4 }],
    medications: [{ drugName: 'Ferrous sulfate', strength: '200 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startedOn: '2026-05-02', reason: 'Iron deficiency anaemia' }],
    results: [
      { testName: 'Haemoglobin', valueText: '10.1', valueNumber: 10.1, unit: 'g/dL', refLow: 12, refHigh: 15.5, daysAgo: 150 },
      { testName: 'Haemoglobin', valueText: '11.2', valueNumber: 11.2, unit: 'g/dL', refLow: 12, refHigh: 15.5, daysAgo: 45 },
      { testName: 'Serum ferritin', valueText: '9', valueNumber: 9, unit: 'ng/mL', refLow: 15, refHigh: 150, daysAgo: 150 },
    ],
    past: [
      {
        daysAgo: 150,
        complaint: 'Tiredness and pallor for two months',
        vitals: [{ kind: 'heart_rate', value: 92 }, { kind: 'systolic_bp', value: 106 }, { kind: 'diastolic_bp', value: 68 }, { kind: 'weight', value: 54 }],
        history: 'Easy fatigue, occasional dizziness. Heavy periods for the last year. No bleeding elsewhere.',
        examination: 'Pale conjunctivae. Pulse 92. Chest and abdomen normal.',
        assessment: 'Probable iron deficiency anaemia. Haemoglobin 10.1 g/dL, ferritin low.',
        plan: 'Start oral iron. Iron-rich diet. Repeat haemoglobin in 6 weeks.',
        followUp: 'Review with repeat haemoglobin.',
        diagnoses: [{ description: 'Iron deficiency anaemia, unspecified', code: 'D50.9' }],
        prescription: [{ drugName: 'Ferrous sulfate', strength: '200 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily', duration: '90 days', instructions: 'After food' }],
      },
    ],
    today: { atOffsetMin: -150, state: 'no_show', complaint: 'Anaemia follow-up' },
  },
  {
    key: 'suresh',
    givenName: 'Suresh',
    familyName: 'Rao',
    dateOfBirth: '1964-09-03',
    sex: 'male',
    phone: '5000100005',
    city: 'Chennai',
    bloodGroup: 'A+',
    department: 'GEN',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing', 'ai_recording'],
    conditions: [
      { name: 'Hypertension', code: 'I10', sinceYear: 2012 },
      { name: 'Coronary artery disease', code: 'I25.1', sinceYear: 2020, sinceMonth: 11, note: 'Stable on treatment' },
    ],
    medications: [
      { drugName: 'Telmisartan', strength: '40 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startedOn: '2016-01-10', reason: 'Hypertension' },
      { drugName: 'Atorvastatin', strength: '20 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily at night', startedOn: '2020-11-20', reason: 'Coronary artery disease' },
      { drugName: 'Aspirin', strength: '75 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily after food', startedOn: '2020-11-20', reason: 'Coronary artery disease' },
    ],
    results: [
      { testName: 'LDL cholesterol', valueText: '82', valueNumber: 82, unit: 'mg/dL', refHigh: 100, daysAgo: 120 },
      { testName: 'Serum creatinine', valueText: '1.1', valueNumber: 1.1, unit: 'mg/dL', refLow: 0.7, refHigh: 1.3, daysAgo: 120 },
    ],
    past: [
      {
        daysAgo: 120,
        complaint: 'Blood pressure and heart follow-up',
        vitals: [{ kind: 'systolic_bp', value: 126 }, { kind: 'diastolic_bp', value: 80 }, { kind: 'heart_rate', value: 66 }],
        history: 'No chest pain, breathlessness or palpitations. Taking all medicines.',
        examination: 'Well. BP 126/80. Heart sounds normal.',
        assessment: 'Hypertension controlled. Stable coronary artery disease.',
        plan: 'Continue current medicines. Review in 4 months.',
        followUp: 'Review in 4 months.',
        diagnoses: [{ description: 'Essential hypertension', code: 'I10' }, { description: 'Chronic ischaemic heart disease', code: 'I25.1', kind: 'secondary' }],
        prescription: [
          { drugName: 'Telmisartan', strength: '40 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily', duration: '120 days' },
          { drugName: 'Atorvastatin', strength: '20 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily at night', duration: '120 days' },
          { drugName: 'Aspirin', strength: '75 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily', duration: '120 days', instructions: 'After food' },
        ],
      },
    ],
    today: { atOffsetMin: 30, state: 'booked', complaint: 'Blood pressure review' },
  },
  {
    key: 'anita',
    givenName: 'Anita',
    familyName: 'Desai',
    dateOfBirth: '1986-03-12',
    sex: 'female',
    phone: '5000100006',
    city: 'Chennai',
    department: 'GEN',
    allergies: [{ substance: 'Latex', reaction: 'Skin irritation', severity: 'mild' }],
    consents: ['data_processing', 'ai_recording', 'ai_record_assistant'],
    conditions: [{ name: 'Hypothyroidism', code: 'E03.9', sinceYear: 2018, sinceMonth: 2 }],
    medications: [{ drugName: 'Levothyroxine', strength: '50 mcg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily in the morning, empty stomach', startedOn: '2018-02-20', reason: 'Hypothyroidism' }],
    results: [{ testName: 'TSH', valueText: '5.8', valueNumber: 5.8, unit: 'mIU/L', refLow: 0.4, refHigh: 4, daysAgo: 70 }],
    past: [
      {
        daysAgo: 70,
        complaint: 'Thyroid review',
        vitals: [{ kind: 'heart_rate', value: 70 }, { kind: 'weight', value: 63 }, { kind: 'systolic_bp', value: 112 }, { kind: 'diastolic_bp', value: 72 }],
        history: 'Mild tiredness and weight gain over three months. Taking levothyroxine regularly.',
        examination: 'Well. Pulse 70. No goitre.',
        assessment: 'Hypothyroidism, TSH 5.8 mIU/L, slightly above range.',
        plan: 'Continue levothyroxine 50 mcg and recheck TSH in 6 weeks; adjust dose then.',
        followUp: 'Review with repeat TSH.',
        diagnoses: [{ description: 'Hypothyroidism, unspecified', code: 'E03.9' }],
        prescription: [{ drugName: 'Levothyroxine', strength: '50 mcg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily in the morning', duration: '60 days', instructions: 'On an empty stomach, 30 minutes before food' }],
      },
    ],
    today: { atOffsetMin: 60, state: 'booked', complaint: 'Thyroid review with repeat TSH' },
  },
  {
    key: 'vikram',
    givenName: 'Vikram',
    familyName: 'Mehta',
    dateOfBirth: '1976-11-25',
    sex: 'male',
    phone: '5000100007',
    city: 'Chennai',
    department: 'GEN',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing'],
    conditions: [{ name: 'Gastro-oesophageal reflux disease', code: 'K21.9', sinceYear: 2023, sinceMonth: 5 }],
    medications: [{ drugName: 'Pantoprazole', strength: '40 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily before breakfast', startedOn: '2023-05-15', reason: 'Reflux' }],
    results: [],
    past: [
      {
        daysAgo: 420,
        complaint: 'Burning in the chest after meals',
        vitals: [{ kind: 'systolic_bp', value: 124 }, { kind: 'diastolic_bp', value: 78 }, { kind: 'heart_rate', value: 72 }],
        history: 'Burning behind the breastbone after heavy meals and when lying down, for two months. No weight loss. No difficulty swallowing.',
        examination: 'Well. Abdomen soft, mild epigastric tenderness.',
        assessment: 'Gastro-oesophageal reflux disease.',
        plan: 'Start pantoprazole. Avoid late heavy meals, raise the head of the bed.',
        followUp: 'Review if symptoms persist after 4 weeks.',
        diagnoses: [{ description: 'Gastro-oesophageal reflux disease without oesophagitis', code: 'K21.9' }],
        prescription: [{ drugName: 'Pantoprazole', strength: '40 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Once daily before breakfast', duration: '28 days' }],
      },
    ],
    today: { atOffsetMin: 90, state: 'booked', complaint: 'Chest discomfort after meals returning' },
  },
  {
    key: 'aarav',
    givenName: 'Aarav',
    familyName: 'Sharma',
    dateOfBirth: '2020-04-18',
    sex: 'male',
    phone: '5000100008',
    city: 'Chennai',
    department: 'PED',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing', 'ai_recording'],
    conditions: [],
    medications: [],
    results: [],
    past: [
      {
        daysAgo: 160,
        complaint: 'Ear pain and fever',
        vitals: [{ kind: 'temperature', value: 38.2 }, { kind: 'heart_rate', value: 110 }, { kind: 'weight', value: 19 }],
        history: 'Two days of right ear pain and fever after a cold. Eating less.',
        examination: 'Right eardrum red and bulging. Throat mildly congested.',
        assessment: 'Acute otitis media, right ear.',
        plan: 'Antibiotic course and paracetamol for pain. Return if no improvement in 48 hours.',
        followUp: 'Review in one week.',
        diagnoses: [{ description: 'Acute otitis media, unspecified', code: 'H66.9' }],
        prescription: [{ drugName: 'Amoxicillin', strength: '250 mg/5 mL', form: 'Syrup', dose: '5 mL', frequency: 'Three times daily', duration: '5 days', instructions: 'Dose per weight, as advised by the doctor' }],
      },
    ],
    today: { state: 'waiting', complaint: 'Fever and rash for one day' },
  },
  {
    key: 'diya',
    givenName: 'Diya',
    familyName: 'Nair',
    dateOfBirth: '2023-01-07',
    sex: 'female',
    phone: '5000100009',
    city: 'Chennai',
    department: 'PED',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing'],
    conditions: [],
    medications: [],
    results: [],
    past: [],
    today: { state: 'ready', complaint: 'Cough and runny nose for four days', vitals: [{ kind: 'temperature', value: 37.8 }, { kind: 'heart_rate', value: 118 }, { kind: 'respiratory_rate', value: 28 }, { kind: 'spo2', value: 98 }, { kind: 'weight', value: 13 }] },
  },
  {
    key: 'kabir',
    givenName: 'Kabir',
    familyName: 'Joshi',
    dateOfBirth: '2017-08-22',
    sex: 'male',
    phone: '5000100010',
    city: 'Chennai',
    department: 'PED',
    allergies: [{ substance: 'Dust mite', reaction: 'Wheeze, sneezing', severity: 'mild' }],
    consents: ['data_processing', 'ai_recording', 'ai_record_assistant'],
    conditions: [{ name: 'Asthma', code: 'J45.9', sinceYear: 2022, sinceMonth: 10 }],
    medications: [{ drugName: 'Salbutamol inhaler', strength: '100 mcg per puff', form: 'Inhaler', dose: '2 puffs', route: 'Inhaled', frequency: 'When needed for wheeze', startedOn: '2022-10-12', reason: 'Asthma' }],
    results: [],
    past: [
      {
        daysAgo: 95,
        complaint: 'Wheeze and night cough',
        vitals: [{ kind: 'respiratory_rate', value: 26 }, { kind: 'spo2', value: 97 }, { kind: 'heart_rate', value: 100 }],
        history: 'Wheeze and night-time cough for three days after a cold. Needed the inhaler twice at night.',
        examination: 'Mild wheeze on both sides. No distress.',
        assessment: 'Asthma with a mild exacerbation.',
        plan: 'Inhaler with a spacer as needed. Avoid dust. Return if breathless or the inhaler is needed more than every 4 hours.',
        followUp: 'Review in 2 weeks.',
        diagnoses: [{ description: 'Asthma, unspecified', code: 'J45.9' }],
        prescription: [{ drugName: 'Salbutamol inhaler', strength: '100 mcg per puff', form: 'Inhaler', dose: '2 puffs', frequency: 'When needed', duration: '30 days', instructions: 'With a spacer' }],
      },
    ],
    today: {
      atOffsetMin: -105,
      state: 'completed',
      complaint: 'Asthma review',
      vitals: [{ kind: 'respiratory_rate', value: 22 }, { kind: 'spo2', value: 98 }, { kind: 'heart_rate', value: 92 }, { kind: 'weight', value: 27 }],
      note: {
        history: 'No night cough in the last month. Using the inhaler about once a week.',
        examination: 'Chest clear. No wheeze.',
        assessment: 'Asthma, well controlled.',
        plan: 'Continue the inhaler as needed. Dust avoidance.',
        followUp: 'Review in 3 months or earlier if symptoms return.',
      },
      diagnoses: [{ description: 'Asthma, unspecified', code: 'J45.9' }],
      prescription: [{ drugName: 'Salbutamol inhaler', strength: '100 mcg per puff', form: 'Inhaler', dose: '2 puffs', frequency: 'When needed', duration: '90 days', instructions: 'With a spacer' }],
    },
  },
  {
    key: 'lakshmi',
    givenName: 'Lakshmi',
    familyName: 'Iyengar',
    dateOfBirth: '1968-06-02',
    sex: 'female',
    phone: '5000100011',
    city: 'Chennai',
    department: 'ORTH',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing', 'ai_recording', 'thermal_imaging'],
    conditions: [{ name: 'Osteoarthritis of the knee', code: 'M17.9', sinceYear: 2021, sinceMonth: 4 }],
    medications: [
      { drugName: 'Paracetamol', strength: '650 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Up to three times daily when needed', startedOn: '2021-05-01', reason: 'Knee pain' },
      { drugName: 'Calcium with vitamin D3', strength: '500 mg / 250 IU', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startedOn: '2022-01-10', reason: 'Bone health' },
    ],
    results: [{ testName: 'Vitamin D (25-OH)', valueText: '22', valueNumber: 22, unit: 'ng/mL', refLow: 30, refHigh: 100, daysAgo: 200 }],
    past: [
      {
        daysAgo: 200,
        complaint: 'Right knee pain on climbing stairs',
        vitals: [{ kind: 'pain_score', value: 5 }, { kind: 'weight', value: 71 }, { kind: 'systolic_bp', value: 128 }, { kind: 'diastolic_bp', value: 80 }],
        history: 'Pain in the right knee for four years, worse on stairs and in the evening. No locking or giving way.',
        examination: 'Mild crepitus right knee, no effusion. Range of movement slightly reduced at full flexion.',
        assessment: 'Osteoarthritis of the right knee.',
        plan: 'Physiotherapy exercises, weight management, paracetamol as needed, vitamin D and calcium.',
        followUp: 'Review in 3 months.',
        diagnoses: [{ description: 'Osteoarthritis of knee, unspecified', code: 'M17.9' }],
        prescription: [{ drugName: 'Paracetamol', strength: '650 mg', form: 'Tablet', dose: '1 tablet', frequency: 'Up to three times daily when needed', duration: '30 days', instructions: 'After food' }],
      },
    ],
    today: { atOffsetMin: -75, state: 'in_triage', complaint: 'Right knee pain worse for two weeks', vitals: [{ kind: 'pain_score', value: 6 }, { kind: 'systolic_bp', value: 130 }, { kind: 'diastolic_bp', value: 82 }] },
  },
  {
    key: 'sanjay',
    givenName: 'Sanjay',
    familyName: 'Gupta',
    dateOfBirth: '1991-12-05',
    sex: 'male',
    phone: '5000100012',
    city: 'Chennai',
    department: 'ORTH',
    allergies: [],
    noKnownAllergies: true,
    consents: ['data_processing'],
    conditions: [],
    medications: [],
    results: [],
    past: [],
    today: { atOffsetMin: 75, state: 'booked', complaint: 'Right ankle pain after a fall' },
  },
]
