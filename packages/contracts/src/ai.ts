import { z } from 'zod'

/** Note sections the assistant may draft into (never diagnoses or prescriptions). */
export const AI_SECTIONS = ['chiefComplaint', 'history', 'pastHistory', 'examination', 'assessment', 'plan', 'followUp'] as const
export const AiSection = z.enum(AI_SECTIONS)
export type AiSection = z.infer<typeof AiSection>

export const ProviderStatus = z.object({ available: z.boolean(), provider: z.string().nullable(), model: z.string().nullable(), reason: z.string().nullable() })
export const AiFeatures = z.object({ noteDraft: z.boolean(), extraction: z.boolean(), recommendations: z.boolean(), imageAnalysis: z.boolean(), liveTranscription: z.boolean(), patientQa: z.boolean() })
/** `qa`: Mana AI summaries of the patient record. */
export const AiStatus = z.object({ llm: ProviderStatus, stt: ProviderStatus, vision: ProviderStatus, qa: ProviderStatus, features: AiFeatures, liveChunkSeconds: z.number() })
export type AiStatus = z.infer<typeof AiStatus>

export const TranscriptSource = z.enum(['typed', 'pasted', 'audio_upload', 'browser_recording'])
/** `id` is the citation label (S1, S2, ...). */
export const TranscriptSegment = z.object({ id: z.string(), speaker: z.string().nullable(), text: z.string(), chunkIndex: z.number().nullable().optional() })
export type TranscriptSegment = z.infer<typeof TranscriptSegment>

export const Transcript = z.object({
  id: z.uuid(),
  source: TranscriptSource,
  /** live: a recording in progress, segments still arriving chunk by chunk. */
  status: z.enum(['final', 'live']),
  audioFileId: z.uuid().nullable(),
  segments: z.array(TranscriptSegment),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
})
export type Transcript = z.infer<typeof Transcript>

export const CreateTranscriptRequest = z.object({
  text: z.string().trim().min(1, 'Enter the transcript').max(50_000, 'At most 50,000 characters'),
  source: z.enum(['typed', 'pasted']).default('pasted'),
})
export type CreateTranscriptRequest = z.input<typeof CreateTranscriptRequest>

export const DraftDecision = z.enum(['pending', 'accepted', 'edited', 'rejected', 'deferred', 'superseded'])
export const AiDraftItem = z.object({
  id: z.uuid(),
  section: AiSection,
  text: z.string(),
  sourceSegmentIds: z.array(z.string()),
  /** True when the model cited no segment that exists in the transcript. */
  unsupported: z.boolean(),
  decision: DraftDecision,
  finalText: z.string().nullable(),
  decidedAt: z.string().nullable(),
})
export type AiDraftItem = z.infer<typeof AiDraftItem>

export const AiRun = z.object({
  id: z.uuid(),
  jobId: z.uuid().nullable(),
  kind: z.string(),
  status: z.enum(['succeeded', 'failed']),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  latencyMs: z.number().nullable(),
  createdAt: z.string(),
})
export type AiRun = z.infer<typeof AiRun>

export const AiDraft = z.object({
  id: z.uuid(),
  transcriptId: z.uuid(),
  createdAt: z.string(),
  run: AiRun,
  items: z.array(AiDraftItem),
})
export type AiDraft = z.infer<typeof AiDraft>

export const AudioRecording = z.object({ fileId: z.uuid(), source: z.enum(['audio_upload', 'browser_recording']), mimeType: z.string(), sizeBytes: z.number(), createdAt: z.string(), transcriptId: z.uuid().nullable() })
export type AudioRecording = z.infer<typeof AudioRecording>

export const EncounterAi = z.object({
  consent: z.object({
    granted: z.boolean(),
    scope: z.enum(['ongoing', 'encounter']).nullable(),
    recordedAt: z.string().nullable(),
    /** Wording version agreed to; only the current wording covers record-aware assistance. */
    version: z.string().nullable(),
    current: z.boolean(),
  }),
  status: AiStatus,
  audio: z.array(AudioRecording),
  transcripts: z.array(Transcript),
  drafts: z.array(AiDraft),
  runs: z.array(AiRun),
  jobs: z.array(z.lazy(() => AiJob)),
  facts: z.array(z.lazy(() => ClinicalFact)),
  recommendations: z.array(z.lazy(() => Recommendation)),
  reviewActions: z.array(z.lazy(() => ReviewAction)),
  audit: z.array(z.lazy(() => AiAuditEntry)),
})
export type EncounterAi = z.infer<typeof EncounterAi>

export const DraftDecisionRequest = z.object({
  decision: z.enum(['accepted', 'edited', 'rejected']),
  /** Required for "edited": the doctor's corrected text. */
  text: z.string().trim().max(8000).optional(),
  /** Required to accept an item the model could not tie to the transcript. */
  confirmUnsupported: z.boolean().optional(),
})
export type DraftDecisionRequest = z.input<typeof DraftDecisionRequest>

export const AiConsentRequest = z.object({ method: z.enum(['verbal', 'written']) })

// ---------------------------------------------------------------------------
// Expanded clinical AI: jobs, extracted facts, evidence, recommendations,
// review actions. Everything here is a draft until a doctor acts on it.
// ---------------------------------------------------------------------------

export const AI_JOB_KINDS = ['transcription', 'note_draft', 'extraction', 'safety_check', 'recommendations', 'image_analysis', 'patient_qa'] as const
export const AiJobKind = z.enum(AI_JOB_KINDS)
export type AiJobKind = z.infer<typeof AiJobKind>

export const FACT_CATEGORIES = {
  chief_complaint: 'Chief complaint',
  symptom: 'Symptom',
  past_medical_history: 'Past medical history',
  medication_history: 'Medication history',
  allergy: 'Allergy',
  family_history: 'Family history',
  social_history: 'Social history',
  examination_finding: 'Examination finding',
  vital_sign: 'Vital sign (mentioned)',
  clinician_assessment: 'Clinician’s assessment',
  plan: 'Plan',
  medication_mention: 'Medicine mentioned in plan',
  follow_up: 'Follow-up',
  red_flag: 'Red-flag statement',
} as const
export type FactCategory = keyof typeof FACT_CATEGORIES
export const FactCategory = z.enum(Object.keys(FACT_CATEGORIES) as [FactCategory, ...FactCategory[]])

/** Note section an accepted fact may be inserted into (null: review only). */
export const FACT_SECTION: Record<FactCategory, AiSection | null> = {
  chief_complaint: 'chiefComplaint',
  symptom: 'history',
  past_medical_history: 'pastHistory',
  medication_history: 'pastHistory',
  allergy: 'pastHistory',
  family_history: 'pastHistory',
  social_history: 'pastHistory',
  examination_finding: 'examination',
  vital_sign: 'examination',
  clinician_assessment: 'assessment',
  plan: 'plan',
  medication_mention: 'plan',
  follow_up: 'followUp',
  red_flag: null,
}

/** Where a statement comes from. Kept distinct everywhere it is shown. */
export const PROVENANCE_LABELS = {
  patient_reported: 'Patient said',
  clinician_stated: 'Clinician said',
  transcript_unlabelled: 'Transcript (speaker not identified)',
  record: 'Existing record',
  device_measured: 'Device measurement',
  staff_measured: 'Measured by staff',
  ai_generated: 'AI suggestion',
} as const
export type Provenance = keyof typeof PROVENANCE_LABELS

export const FACT_FLAGS = {
  uncertain: 'Uncertain or unclear in the conversation',
  no_source: 'Not linked to any transcript line',
  conflicts_with_record: 'Conflicts with the existing record',
  not_in_record: 'Not in the existing record',
  speaker_mismatch: 'Attributed speaker does not match the transcript',
  red_flag: 'Red-flag statement',
} as const
export type FactFlag = keyof typeof FACT_FLAGS
/** Flags that must be explicitly confirmed before a fact can be accepted. */
export const CONFIRM_FLAGS: FactFlag[] = ['uncertain', 'no_source', 'conflicts_with_record', 'speaker_mismatch']

export const ReviewStatus = z.enum(['pending', 'accepted', 'edited', 'rejected', 'deferred', 'superseded'])
export type ReviewStatus = z.infer<typeof ReviewStatus>

export const Evidence = z.object({
  id: z.uuid(),
  relation: z.enum(['supports', 'conflicts']),
  sourceType: z.string(),
  sourceId: z.string().nullable(),
  sourceRef: z.string(),
  provenance: z.string(),
  excerpt: z.string(),
  note: z.string().nullable(),
})
export type Evidence = z.infer<typeof Evidence>

export const ClinicalFact = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  transcriptId: z.uuid(),
  category: FactCategory,
  text: z.string(),
  attribution: z.enum(['patient_reported', 'clinician_stated', 'other_speaker']),
  certainty: z.enum(['stated', 'uncertain']),
  uncertaintyReason: z.string().nullable(),
  negated: z.boolean(),
  attributes: z.record(z.string(), z.unknown()),
  flags: z.array(z.string()),
  status: ReviewStatus,
  finalText: z.string().nullable(),
  decidedAt: z.string().nullable(),
  evidence: z.array(Evidence),
})
export type ClinicalFact = z.infer<typeof ClinicalFact>

export const RECOMMENDATION_KINDS = {
  red_flag: 'Red flag',
  safety_check: 'Safety check',
  clarification: 'Clarify',
  missing_information: 'Missing information',
  investigation: 'Consider investigation',
  follow_up: 'Follow-up',
  referral_consideration: 'Consider referral',
  documentation: 'Documentation',
} as const
export type RecommendationKind = keyof typeof RECOMMENDATION_KINDS

export const Recommendation = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  source: z.enum(['rules', 'llm']),
  kind: z.string(),
  urgency: z.enum(['routine', 'attention']),
  text: z.string(),
  rationale: z.string(),
  instruction: z.string().nullable(),
  missingInformation: z.array(z.object({ text: z.string() })),
  unsupported: z.boolean(),
  status: ReviewStatus,
  finalText: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /** Provider, model and prompt or rules version of the run that produced it. */
  producedBy: z.object({ provider: z.string(), model: z.string(), version: z.string().nullable() }),
  evidence: z.array(Evidence),
})
export type Recommendation = z.infer<typeof Recommendation>

export const AiJob = z.object({
  id: z.uuid(),
  kind: AiJobKind,
  status: z.enum(['running', 'succeeded', 'failed']),
  attempts: z.number(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  retryable: z.boolean(),
  dataOrigin: z.string(),
  settingsSha256: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  createdByName: z.string().nullable(),
  runs: z.array(AiRun),
})
export type AiJob = z.infer<typeof AiJob>

export const ReviewAction = z.object({
  id: z.uuid(),
  subjectType: z.string(),
  subjectId: z.uuid(),
  action: z.string(),
  text: z.string().nullable(),
  reason: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
})
export type ReviewAction = z.infer<typeof ReviewAction>

export const AiAuditEntry = z.object({ id: z.string(), action: z.string(), outcome: z.string(), actorName: z.string().nullable(), occurredAt: z.string() })
export type AiAuditEntry = z.infer<typeof AiAuditEntry>

export const ReviewRequest = z.object({
  action: z.enum(['accepted', 'edited', 'rejected', 'deferred']),
  /** Required for "edited". */
  text: z.string().trim().max(8000).optional(),
  reason: z.string().trim().max(500).optional(),
  /** Required to accept an item with review flags or without verified support. */
  confirmFlags: z.boolean().optional(),
})
export type ReviewRequest = z.input<typeof ReviewRequest>

/** Optional client-generated key that makes a job-starting request safe to resend. */
export const JobRequest = z.object({ idempotencyKey: z.uuid().optional() })
export type JobRequest = z.input<typeof JobRequest>
