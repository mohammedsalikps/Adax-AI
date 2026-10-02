// Drizzle schema. Source of truth for generated migrations in ../../drizzle.
// Tables are added milestone by milestone; never edit an applied migration.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/** Case-insensitive text (extension `citext`, created in 0000_extensions). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' })

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/** A clinic / OPD site. The MVP runs a single facility; the table keeps room for more. */
export const facilities = pgTable('facilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

// ---------------------------------------------------------------------------
// Identity and access
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['admin', 'doctor', 'nurse', 'patient'])

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('departments_facility_code_uq').on(t.facilityId, t.code)],
)

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id),
    username: citext('username').notNull().unique(),
    fullName: text('full_name').notNull(),
    role: userRole('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    departmentId: uuid('department_id').references(() => departments.id),
    /** Medical council registration number (doctors). Free text, not verified. */
    registrationNumber: text('registration_number'),
    /** Set for role = patient; FK added with the patients table. */
    patientId: uuid('patient_id'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [index('users_role_idx').on(t.role)],
)

/** Server-side sessions. Only a SHA-256 hash of the cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/**
 * Append-only audit trail. UPDATE, DELETE and TRUNCATE are blocked by
 * triggers (migration 0003), so even the application role cannot rewrite it.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    outcome: text('outcome').notNull().default('success'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    patientId: uuid('patient_id'),
    requestId: text('request_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('audit_events_occurred_idx').on(t.occurredAt),
    index('audit_events_actor_idx').on(t.actorUserId),
    index('audit_events_patient_idx').on(t.patientId),
    index('audit_events_action_idx').on(t.action),
  ],
)

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export const sex = pgEnum('sex', ['female', 'male', 'other', 'unknown'])

/** MRNs come from this sequence: ADX-001001, ADX-001002, ... */
export const patientMrnSeq = pgSequence('patient_mrn_seq', { startWith: 1001, minValue: 1 })

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    mrn: citext('mrn')
      .notNull()
      .unique()
      .default(sql`'ADX-' || lpad(nextval('patient_mrn_seq')::text, 6, '0')`),
    givenName: text('given_name').notNull(),
    familyName: text('family_name'),
    /** Lower-cased full name for search (trigram index). */
    searchName: text('search_name').generatedAlwaysAs(sql`lower(given_name || ' ' || coalesce(family_name, ''))`),
    dateOfBirth: date('date_of_birth').notNull(),
    dateOfBirthEstimated: boolean('date_of_birth_estimated').notNull().default(false),
    sex: sex('sex').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    /** ABHA number as entered (digits). Not verified with ABDM. */
    abhaNumber: text('abha_number'),
    bloodGroup: text('blood_group'),
    preferredLanguage: text('preferred_language'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    noKnownAllergies: boolean('no_known_allergies').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('patients_search_name_trgm').using('gin', sql`${t.searchName} gin_trgm_ops`),
    index('patients_phone_idx').on(t.phone),
    index('patients_dob_idx').on(t.dateOfBirth),
  ],
)

export const allergySeverity = pgEnum('allergy_severity', ['mild', 'moderate', 'severe', 'unknown'])

export const allergies = pgTable(
  'allergies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    substance: text('substance').notNull(),
    reaction: text('reaction'),
    severity: allergySeverity('severity').notNull().default('unknown'),
    status: text('status').notNull().default('active'),
    recordedBy: uuid('recorded_by').references(() => users.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('allergies_patient_idx').on(t.patientId)],
)

export const consentType = pgEnum('consent_type', ['data_processing', 'ai_recording', 'thermal_imaging', 'device_monitoring', 'portal_access', 'research_use'])
export const consentMethod = pgEnum('consent_method', ['verbal', 'written', 'digital'])

/** Consent records are never deleted; withdrawal is recorded on the row. */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    type: consentType('type').notNull(),
    status: text('status').notNull().default('granted'),
    method: consentMethod('method').notNull(),
    scope: text('scope').notNull().default('ongoing'),
    /** Set for encounter-scoped consent (FK added with encounters). */
    encounterId: uuid('encounter_id'),
    /** Version of the consent wording shown or read to the patient. */
    version: text('version').notNull().default('2026-10-v1'),
    notes: text('notes'),
    recordedBy: uuid('recorded_by').references(() => users.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnBy: uuid('withdrawn_by').references(() => users.id),
  },
  (t) => [index('consents_patient_idx').on(t.patientId, t.type)],
)

/** One-time codes a patient uses to activate their portal account. Only a hash is stored. */
export const patientActivationCodes = pgTable(
  'patient_activation_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activation_codes_patient_idx').on(t.patientId)],
)

// ---------------------------------------------------------------------------
// OPD visits (queue) and observations
// ---------------------------------------------------------------------------

export const visitStatus = pgEnum('visit_status', ['waiting', 'in_triage', 'ready', 'in_consultation', 'completed', 'cancelled', 'no_show'])
export const visitPriority = pgEnum('visit_priority', ['normal', 'urgent'])

export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    assignedDoctorId: uuid('assigned_doctor_id').references(() => users.id),
    /** Calendar day in the facility's timezone. */
    visitDate: date('visit_date').notNull(),
    tokenNumber: integer('token_number').notNull(),
    status: visitStatus('status').notNull().default('waiting'),
    priority: visitPriority('priority').notNull().default('normal'),
    chiefComplaint: text('chief_complaint'),
    statusReason: text('status_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('visits_token_uq').on(t.facilityId, t.visitDate, t.tokenNumber),
    // At most one open visit per patient per day.
    uniqueIndex('visits_one_open_per_day_uq')
      .on(t.patientId, t.visitDate)
      .where(sql`status in ('waiting', 'in_triage', 'ready', 'in_consultation')`),
    index('visits_date_status_idx').on(t.facilityId, t.visitDate, t.status),
    index('visits_patient_idx').on(t.patientId),
  ],
)

/** Atomic per-day token numbers (INSERT ... ON CONFLICT DO UPDATE ... RETURNING). */
export const dailyTokenCounters = pgTable(
  'daily_token_counters',
  {
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    visitDate: date('visit_date').notNull(),
    lastToken: integer('last_token').notNull(),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.visitDate] })],
)

export const vitalKind = pgEnum('vital_kind', ['heart_rate', 'respiratory_rate', 'systolic_bp', 'diastolic_bp', 'temperature', 'spo2', 'weight', 'height', 'blood_glucose', 'pain_score'])
export const observationSource = pgEnum('observation_source', ['manual', 'device'])

/**
 * Measurements. Never deleted or edited: a wrong value is marked
 * entered-in-error (with a reason) and the corrected value is recorded anew.
 */
export const observations = pgTable(
  'observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    visitId: uuid('visit_id').references(() => visits.id),
    kind: vitalKind('kind').notNull(),
    value: numeric('value', { precision: 8, scale: 2, mode: 'number' }).notNull(),
    unit: text('unit').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
    source: observationSource('source').notNull().default('manual'),
    validationStatus: text('validation_status').notNull().default('manual_entry'),
    /** Device that produced the value (FK added with devices). */
    deviceId: uuid('device_id'),
    recordedBy: uuid('recorded_by').references(() => users.id),
    enteredInError: boolean('entered_in_error').notNull().default(false),
    enteredInErrorReason: text('entered_in_error_reason'),
    enteredInErrorBy: uuid('entered_in_error_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('observations_patient_kind_idx').on(t.patientId, t.kind, t.measuredAt), index('observations_visit_idx').on(t.visitId)],
)

// ---------------------------------------------------------------------------
// Consultations (encounters), diagnoses, prescriptions, amendments
// ---------------------------------------------------------------------------

export const encounterStatus = pgEnum('encounter_status', ['in_progress', 'signed'])

/**
 * One consultation per visit. Once signed, the row and its diagnoses and
 * prescription items are immutable (database triggers, migration 0006);
 * corrections are appended as amendments.
 */
export const encounters = pgTable(
  'encounters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    visitId: uuid('visit_id')
      .notNull()
      .unique()
      .references(() => visits.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => users.id),
    status: encounterStatus('status').notNull().default('in_progress'),
    version: integer('version').notNull().default(1),
    chiefComplaint: text('chief_complaint').notNull().default(''),
    history: text('history').notNull().default(''),
    pastHistory: text('past_history').notNull().default(''),
    examination: text('examination').notNull().default(''),
    assessment: text('assessment').notNull().default(''),
    plan: text('plan').notNull().default(''),
    followUp: text('follow_up').notNull().default(''),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    /** Canonical JSON of what was signed, and its SHA-256. */
    signedSnapshot: jsonb('signed_snapshot'),
    contentHash: text('content_hash'),
  },
  (t) => [index('encounters_patient_idx').on(t.patientId), index('encounters_doctor_status_idx').on(t.doctorId, t.status)],
)

export const diagnosisKind = pgEnum('diagnosis_kind', ['provisional', 'primary', 'secondary'])

export const diagnoses = pgTable(
  'diagnoses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    description: text('description').notNull(),
    /** ICD-10 code as typed; format-checked only, not validated against a code set. */
    code: text('code'),
    kind: diagnosisKind('kind').notNull().default('primary'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('diagnoses_encounter_idx').on(t.encounterId)],
)

export const prescriptionItems = pgTable(
  'prescription_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    drugName: text('drug_name').notNull(),
    strength: text('strength').notNull().default(''),
    form: text('form').notNull().default(''),
    dose: text('dose').notNull(),
    route: text('route').notNull().default('Oral'),
    frequency: text('frequency').notNull(),
    duration: text('duration').notNull(),
    instructions: text('instructions').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('prescription_items_encounter_idx').on(t.encounterId)],
)

// ---------------------------------------------------------------------------
// Uploaded files and the AI consultation assistant
// ---------------------------------------------------------------------------

/** Uploaded binaries live on disk (STORAGE_DIR); this row is their metadata and access anchor. */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id').references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
    /** consultation_audio | stethoscope_audio | thermal_raw | thermal_matrix | thermal_visual | dataset_export */
    kind: text('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('files_encounter_idx').on(t.encounterId), index('files_patient_idx').on(t.patientId)],
)

/** Every call to an external AI provider: what ran, with which model and prompt version, and how it ended. Content is not duplicated here. */
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    inputSha256: text('input_sha256'),
    outputSha256: text('output_sha256'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    providerRequestId: text('provider_request_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_runs_encounter_idx').on(t.encounterId)],
)

export const transcripts = pgTable(
  'transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    source: text('source').notNull(),
    audioFileId: uuid('audio_file_id').references(() => files.id),
    sttRunId: uuid('stt_run_id').references(() => aiRuns.id),
    /** [{ id: "S1", speaker: "Doctor" | null, text }] */
    segments: jsonb('segments').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transcripts_encounter_idx').on(t.encounterId)],
)

export const aiDrafts = pgTable(
  'ai_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => transcripts.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_drafts_encounter_idx').on(t.encounterId)],
)

/** One suggested passage. Nothing reaches the note until a doctor accepts or edits it. */
export const aiDraftItems = pgTable(
  'ai_draft_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => aiDrafts.id),
    section: text('section').notNull(),
    text: text('text').notNull(),
    sourceSegmentIds: jsonb('source_segment_ids').notNull(),
    unsupported: boolean('unsupported').notNull().default(false),
    decision: text('decision').notNull().default('pending'),
    finalText: text('final_text'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('ai_draft_items_draft_idx').on(t.draftId)],
)

// ---------------------------------------------------------------------------
// Thermal imaging
// ---------------------------------------------------------------------------

/**
 * A radiometric thermal image and its extracted temperature matrix. Draft
 * until a doctor approves or rejects it; then it and its ROIs are frozen
 * (trigger, migration 0009).
 */
export const thermalCaptures = pgTable(
  'thermal_captures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
    rawFileId: uuid('raw_file_id')
      .notNull()
      .references(() => files.id),
    matrixFileId: uuid('matrix_file_id')
      .notNull()
      .references(() => files.id),
    visibleFileId: uuid('visible_file_id').references(() => files.id),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    minC: numeric('min_c', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    maxC: numeric('max_c', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    meanC: numeric('mean_c', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    camera: jsonb('camera').notNull(),
    parameters: jsonb('parameters').notNull(),
    extractor: jsonb('extractor').notNull(),
    protocol: jsonb('protocol').notNull(),
    pairStats: jsonb('pair_stats').notNull().default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('draft'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** clinical | synthetic | public_sample - set at upload from deployment config or a known sample checksum. */
    dataOrigin: text('data_origin').notNull().default('synthetic'),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [check('thermal_captures_data_origin_check', sql`${t.dataOrigin} in ('clinical', 'synthetic', 'public_sample')`), index('thermal_captures_patient_idx').on(t.patientId), index('thermal_captures_encounter_idx').on(t.encounterId)],
)

export const thermalRois = pgTable(
  'thermal_rois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    captureId: uuid('capture_id')
      .notNull()
      .references(() => thermalCaptures.id),
    label: text('label').notNull(),
    shape: text('shape').notNull(),
    x: numeric('x', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    y: numeric('y', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    width: numeric('width', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    height: numeric('height', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    pairWith: text('pair_with'),
    stats: jsonb('stats').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('thermal_rois_capture_idx').on(t.captureId)],
)

/**
 * Clinician labels on reviewed thermal captures, for building evaluation
 * datasets. Never deleted: a label is withdrawn (once, with a reason) and a
 * new one added. Trigger in migration 0010 enforces this.
 */
export const thermalLabels = pgTable(
  'thermal_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    captureId: uuid('capture_id')
      .notNull()
      .references(() => thermalCaptures.id),
    /** capture | roi */
    scope: text('scope').notNull(),
    roiLabel: text('roi_label'),
    code: text('code').notNull(),
    referenceStandard: text('reference_standard').notNull(),
    certainty: text('certainty').notNull(),
    note: text('note'),
    taxonomyVersion: text('taxonomy_version').notNull(),
    labelledBy: uuid('labelled_by')
      .notNull()
      .references(() => users.id),
    labelledAt: timestamp('labelled_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnBy: uuid('withdrawn_by').references(() => users.id),
    withdrawReason: text('withdraw_reason'),
  },
  (t) => [
    check('thermal_labels_scope_check', sql`(${t.scope} = 'capture' and ${t.roiLabel} is null) or (${t.scope} = 'roi' and ${t.roiLabel} is not null)`),
    index('thermal_labels_capture_idx').on(t.captureId),
    // One active label per rater per image (or per region).
    uniqueIndex('thermal_labels_one_active_per_rater').on(t.captureId, t.labelledBy, sql`coalesce(lower(${t.roiLabel}), '')`).where(sql`${t.withdrawnAt} is null`),
  ],
)

/** De-identified dataset exports (the ZIP is a stored file) and their evaluation report. */
export const thermalDatasetExports = pgTable('thermal_dataset_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id),
  summary: jsonb('summary').notNull(),
  evaluation: jsonb('evaluation'),
  evaluationMarkdown: text('evaluation_markdown'),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Post-signing corrections. Append-only (triggers block UPDATE/DELETE). */
export const encounterAmendments = pgTable(
  'encounter_amendments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('amendments_encounter_idx').on(t.encounterId)],
)
