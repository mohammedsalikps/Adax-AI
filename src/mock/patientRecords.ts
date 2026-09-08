import type {
  FamilyHistoryEntry,
  LabReport,
  StudyReport,
} from '@/types/record'

/* ------------------------------------------------------------------
   Investigation records. Entirely fictional demonstration data.

   Values are written to be consistent with what each patient's chart
   already says — Ramesh Iyer's chart records type 2 diabetes with
   suboptimal control and hypertension, so his HbA1c and lipids read that
   way rather than contradicting the rest of the record.

   Flags and abnormal markers are authored here alongside the reference
   ranges they were judged against. Nothing downstream re-decides whether a
   result is abnormal.
------------------------------------------------------------------ */

const LAB_REPORTS: LabReport[] = [
  {
    id: 'lab_ri_hba1c_2026_06',
    patientId: 'PT-2026-00142',
    panelName: 'HbA1c',
    collectedOn: '2026-06-10T08:15:00',
    reportedOn: '2026-06-11T17:40:00',
    laboratory: 'Sunrise Diagnostics, Bengaluru',
    impression: 'Above target for a patient on oral therapy.',
    analytes: [
      {
        id: 'an_hba1c',
        name: 'Glycated haemoglobin (HbA1c)',
        value: '8.2',
        unit: '%',
        referenceRange: '< 7.0 % (target on therapy)',
        flag: 'high',
      },
      {
        id: 'an_eag',
        name: 'Estimated average glucose',
        value: '189',
        unit: 'mg/dL',
        referenceRange: '< 154 mg/dL',
        flag: 'high',
      },
    ],
  },
  {
    id: 'lab_ri_lipid_2026_06',
    patientId: 'PT-2026-00142',
    panelName: 'Lipid profile',
    collectedOn: '2026-06-10T08:15:00',
    reportedOn: '2026-06-11T17:40:00',
    laboratory: 'Sunrise Diagnostics, Bengaluru',
    analytes: [
      {
        id: 'an_tchol',
        name: 'Total cholesterol',
        value: '196',
        unit: 'mg/dL',
        referenceRange: '< 200 mg/dL',
        flag: 'normal',
      },
      {
        id: 'an_ldl',
        name: 'LDL cholesterol',
        value: '118',
        unit: 'mg/dL',
        referenceRange: '< 100 mg/dL',
        flag: 'high',
      },
      {
        id: 'an_hdl',
        name: 'HDL cholesterol',
        value: '38',
        unit: 'mg/dL',
        referenceRange: '> 40 mg/dL',
        flag: 'low',
      },
      {
        id: 'an_tg',
        name: 'Triglycerides',
        value: '184',
        unit: 'mg/dL',
        referenceRange: '< 150 mg/dL',
        flag: 'high',
      },
    ],
  },
  {
    id: 'lab_ri_renal_2026_03',
    patientId: 'PT-2026-00142',
    panelName: 'Renal function',
    collectedOn: '2026-03-06T09:05:00',
    reportedOn: '2026-03-06T19:20:00',
    laboratory: 'Sunrise Diagnostics, Bengaluru',
    impression: 'Renal function preserved.',
    analytes: [
      {
        id: 'an_creat',
        name: 'Serum creatinine',
        value: '0.9',
        unit: 'mg/dL',
        referenceRange: '0.7 – 1.3 mg/dL',
        flag: 'normal',
      },
      {
        id: 'an_urea',
        name: 'Blood urea',
        value: '28',
        unit: 'mg/dL',
        referenceRange: '15 – 40 mg/dL',
        flag: 'normal',
      },
      {
        id: 'an_acr',
        name: 'Urine albumin/creatinine ratio',
        value: '22',
        unit: 'mg/g',
        referenceRange: '< 30 mg/g',
        flag: 'normal',
      },
    ],
  },
  {
    id: 'lab_mn_cbc_2026_05',
    patientId: 'PT-2026-00118',
    panelName: 'Complete blood count',
    collectedOn: '2026-05-26T10:30:00',
    reportedOn: '2026-05-26T18:00:00',
    laboratory: 'Sunrise Diagnostics, Bengaluru',
    analytes: [
      {
        id: 'an_hb_mn',
        name: 'Haemoglobin',
        value: '11.8',
        unit: 'g/dL',
        referenceRange: '12.0 – 15.5 g/dL',
        flag: 'low',
      },
      {
        id: 'an_wbc_mn',
        name: 'Total leucocyte count',
        value: '7200',
        unit: '/µL',
        referenceRange: '4000 – 11000 /µL',
        flag: 'normal',
      },
      {
        id: 'an_plt_mn',
        name: 'Platelet count',
        value: '244000',
        unit: '/µL',
        referenceRange: '150000 – 410000 /µL',
        flag: 'normal',
      },
    ],
  },
  {
    id: 'lab_ak_hb_2026_04',
    patientId: 'PT-2026-00171',
    panelName: 'Haemoglobin',
    collectedOn: '2026-04-04T09:40:00',
    reportedOn: '2026-04-04T16:10:00',
    laboratory: 'Sunrise Diagnostics, Bengaluru',
    impression: 'Consistent with iron deficiency anaemia.',
    analytes: [
      {
        id: 'an_hb_ak',
        name: 'Haemoglobin',
        value: '9.6',
        unit: 'g/dL',
        referenceRange: '12.0 – 15.5 g/dL',
        flag: 'low',
      },
      {
        id: 'an_ferritin_ak',
        name: 'Serum ferritin',
        value: '9',
        unit: 'ng/mL',
        referenceRange: '15 – 150 ng/mL',
        flag: 'low',
      },
    ],
  },
  {
    id: 'lab_sr_thyroid_2026_07',
    patientId: 'PT-2026-00190',
    panelName: 'Thyroid function',
    collectedOn: '2026-07-28T08:50:00',
    reportedOn: '2026-07-29T12:15:00',
    laboratory: 'Sunrise Diagnostics, Bengaluru',
    analytes: [
      {
        id: 'an_tsh_sr',
        name: 'TSH',
        value: '6.8',
        unit: 'µIU/mL',
        referenceRange: '0.4 – 4.5 µIU/mL',
        flag: 'high',
      },
      {
        id: 'an_ft4_sr',
        name: 'Free T4',
        value: '0.9',
        unit: 'ng/dL',
        referenceRange: '0.8 – 1.8 ng/dL',
        flag: 'normal',
      },
    ],
  },
]

const STUDY_REPORTS: StudyReport[] = [
  {
    id: 'std_ri_ecg_2026_06',
    patientId: 'PT-2026-00142',
    modality: 'ecg',
    studyName: 'Resting 12-lead ECG',
    performedOn: '2026-06-12T10:05:00',
    facility: 'Sunrise Medical Centre',
    findings: 'Sinus rhythm at 82/min. Normal axis. No ST-segment deviation.',
    impression: 'Normal resting ECG.',
    abnormal: false,
  },
  {
    id: 'std_ri_cxr_2025_11',
    patientId: 'PT-2026-00142',
    modality: 'x-ray',
    studyName: 'Chest X-ray, PA view',
    performedOn: '2025-11-15T11:30:00',
    facility: 'Sunrise Medical Centre',
    findings:
      'Lung fields clear. Cardiothoracic ratio within normal limits. No pleural effusion.',
    impression: 'No acute cardiopulmonary abnormality.',
    abnormal: false,
  },
  {
    id: 'std_vs_echo_2026_08',
    patientId: 'PT-2026-00163',
    modality: 'echo',
    studyName: 'Transthoracic echocardiogram',
    performedOn: '2026-08-20T14:20:00',
    facility: 'Sunrise Medical Centre',
    findings:
      'Mild concentric left ventricular hypertrophy. Ejection fraction 58%. No regional wall motion abnormality.',
    impression: 'Mild LVH with preserved systolic function.',
    abnormal: true,
  },
  {
    id: 'std_ad_xray_2026_08',
    patientId: 'PT-2026-00097',
    modality: 'x-ray',
    studyName: 'Right knee X-ray, AP and lateral',
    performedOn: '2026-08-19T09:45:00',
    facility: 'Sunrise Medical Centre',
    findings: 'Prosthesis in satisfactory position. No periprosthetic lucency.',
    impression: 'Satisfactory post-operative appearance.',
    abnormal: false,
  },
  {
    id: 'std_fs_spiro_2026_07',
    patientId: 'PT-2026-00156',
    modality: 'x-ray',
    studyName: 'Chest X-ray, PA view',
    performedOn: '2026-07-30T10:10:00',
    facility: 'Sunrise Medical Centre',
    findings: 'Hyperinflated lung fields. No focal consolidation.',
    impression: 'Changes consistent with obstructive airway disease.',
    abnormal: true,
  },
]

const FAMILY_HISTORY: FamilyHistoryEntry[] = [
  {
    id: 'fam_ri_1',
    patientId: 'PT-2026-00142',
    relation: 'Father',
    condition: 'Type 2 diabetes mellitus',
    ageAtDiagnosis: 51,
    note: 'Managed on oral therapy.',
  },
  {
    id: 'fam_ri_2',
    patientId: 'PT-2026-00142',
    relation: 'Mother',
    condition: 'Hypertension',
    ageAtDiagnosis: 58,
  },
  {
    id: 'fam_ri_3',
    patientId: 'PT-2026-00142',
    relation: 'Elder brother',
    condition: 'Type 2 diabetes mellitus',
    ageAtDiagnosis: 47,
  },
  {
    id: 'fam_mn_1',
    patientId: 'PT-2026-00118',
    relation: 'Mother',
    condition: 'Migraine',
    note: 'Similar pattern of visual aura.',
  },
  {
    id: 'fam_vs_1',
    patientId: 'PT-2026-00163',
    relation: 'Father',
    condition: 'Coronary artery disease',
    ageAtDiagnosis: 62,
    note: 'Myocardial infarction at 62.',
  },
  {
    id: 'fam_fs_1',
    patientId: 'PT-2026-00156',
    relation: 'Mother',
    condition: 'Asthma',
  },
]

/** Laboratory panels for one patient, most recently reported first. */
export function getLabReports(patientId: string): LabReport[] {
  return LAB_REPORTS.filter((report) => report.patientId === patientId).sort((a, b) =>
    b.reportedOn.localeCompare(a.reportedOn),
  )
}

/** Imaging and diagnostic studies for one patient, most recent first. */
export function getStudyReports(patientId: string): StudyReport[] {
  return STUDY_REPORTS.filter((report) => report.patientId === patientId).sort((a, b) =>
    b.performedOn.localeCompare(a.performedOn),
  )
}

/** Recorded family history for one patient. */
export function getFamilyHistory(patientId: string): FamilyHistoryEntry[] {
  return FAMILY_HISTORY.filter((entry) => entry.patientId === patientId)
}
