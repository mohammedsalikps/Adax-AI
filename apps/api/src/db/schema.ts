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
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
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
 * triggers (migration 0003), and the application role holds no UPDATE or
 * DELETE privilege on it (migration 0019). Since migration 0019 every new
 * event is linked into a SHA-256 hash chain by a database trigger
 * (chain_seq, prev_hash, row_hash); events from before that are summarised by
 * the `audit.chain_start` event. See docs/adr/0008.
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
    /** Facility the event belongs to (actor's or patient's); null for anonymous events and rows before migration 0017. */
    facilityId: uuid('facility_id'),
    /** Hash chain, set by the database (never by the application); null for events before migration 0019. */
    chainSeq: bigint('chain_seq', { mode: 'number' }),
    prevHash: text('prev_hash'),
    rowHash: text('row_hash'),
    chainVersion: smallint('chain_version'),
  },
  (t) => [
    uniqueIndex('audit_events_chain_seq_uq').on(t.chainSeq),
    index('audit_events_occurred_idx').on(t.occurredAt),
    index('audit_events_facility_idx').on(t.facilityId, t.occurredAt),
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

export const consentType = pgEnum('consent_type', ['data_processing', 'ai_recording', 'thermal_imaging', 'device_monitoring', 'portal_access', 'research_use', 'clinical_photography', 'ai_image_analysis', 'ai_record_assistant'])
export const consentMethod = pgEnum('consent_method', ['verbal', 'written', 'digital'])

/**
 * Consent records are never deleted or rewritten. A granted consent ends once:
 * withdrawn (with who, when, why and how) or superseded by a renewal under
 * newer wording (trigger, migration 0017). At most one ongoing grant per
 * patient and purpose is active.
 */
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
    /** Optional reason given at withdrawal (shown on the record; never copied into the audit log). */
    withdrawReason: text('withdraw_reason'),
    /** staff | patient_portal */
    withdrawnVia: text('withdrawn_via'),
    /** The renewal that replaced this grant (status superseded). */
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => consents.id),
  },
  (t) => [
    index('consents_patient_idx').on(t.patientId, t.type),
    uniqueIndex('consents_one_active_ongoing_uq').on(t.patientId, t.type).where(sql`status = 'granted' and scope = 'ongoing'`),
    check('consents_status_check', sql`${t.status} in ('granted', 'withdrawn', 'superseded')`),
  ],
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
    /** Device that produced the value (source = device). */
    deviceId: uuid('device_id').references((): AnyPgColumn => devices.id),
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

export const encounterStatus = pgEnum('encounter_status', ['in_progress', 'signed', 'discarded'])

/**
 * A consultation for a visit: in_progress (an unsigned draft), then signed or
 * discarded, never both and never back. A visit has at most one consultation
 * that is not discarded. Signed and discarded rows, and their diagnoses and
 * prescription items, are immutable (database triggers, migrations 0006 and
 * 0019); signed records are corrected only by appending amendments. Every
 * status change is recorded in encounter_status_events by the database.
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
    /** How content_hash was computed (e.g. adaxai.encounter.v2); null for records signed before migration 0019 (scheme v1). */
    hashScheme: text('hash_scheme'),
    /** A draft closed without signing: kept read-only with who, when and why. */
    discardedAt: timestamp('discarded_at', { withTimezone: true }),
    discardedBy: uuid('discarded_by').references(() => users.id),
    discardReason: text('discard_reason'),
  },
  (t) => [
    index('encounters_patient_idx').on(t.patientId),
    index('encounters_doctor_status_idx').on(t.doctorId, t.status),
    uniqueIndex('encounters_one_active_per_visit_uq').on(t.visitId).where(sql`status <> 'discarded'`),
    index('encounters_visit_idx').on(t.visitId),
    check('encounters_signed_complete', sql`status <> 'signed' or (signed_at is not null and signed_snapshot is not null and content_hash is not null)`),
    check('encounters_discarded_complete', sql`status <> 'discarded' or (discarded_at is not null and discarded_by is not null and length(btrim(coalesce(discard_reason, ''))) > 0)`),
    check('encounters_hash_scheme_format', sql`hash_scheme is null or hash_scheme ~ '^adaxai[.]encounter[.]v[0-9]+$'`),
  ],
)

/**
 * Status history of consultations, written by a database trigger on every
 * insert and status change (append-only). Consultations from before
 * migration 0019 have a single baseline event.
 */
export const encounterStatusEvents = pgTable(
  'encounter_status_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id),
    fromStatus: encounterStatus('from_status'),
    toStatus: encounterStatus('to_status').notNull(),
    source: text('source').notNull(),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('encounter_status_events_encounter_idx').on(t.encounterId, t.id)],
)

/**
 * Status history of visits, written by a database trigger on check-in and on
 * every status change (append-only), with the acting user, the source of the
 * change and the reason. The same trigger refuses transitions that are not
 * allowed (migration 0019). Visits from before 0019 have a baseline event.
 */
export const visitStatusEvents = pgTable(
  'visit_status_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id),
    fromStatus: visitStatus('from_status'),
    toStatus: visitStatus('to_status').notNull(),
    source: text('source').notNull(),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('visit_status_events_visit_idx').on(t.visitId, t.id)],
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
    /** Set when the stored bytes were removed (retention); the row is kept. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedReason: text('deleted_reason'),
  },
  (t) => [index('files_encounter_idx').on(t.encounterId), index('files_patient_idx').on(t.patientId)],
)

/** Every call to an external AI provider: what ran, with which model and prompt version, and how it ended. Content is not duplicated here. */
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null only for runs recorded before jobs existed (migration 0011). */
    jobId: uuid('job_id').references((): AnyPgColumn => aiJobs.id),
    patientId: uuid('patient_id').references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
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
  (t) => [index('ai_runs_encounter_idx').on(t.encounterId), index('ai_runs_job_idx').on(t.jobId)],
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
    /** final | live (recording in progress; segments still being added) */
    status: text('status').notNull().default('final'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
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

/**
 * One numbered part of a transcript (S1, S2, ...). AI output cites these
 * labels. Append-only (trigger, migration 0011): the transcript is evidence.
 */
export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => transcripts.id),
    seq: integer('seq').notNull(),
    label: text('label').notNull(),
    speaker: text('speaker'),
    /** typed_label (a "Doctor:" prefix) | provider (speech-to-text diarisation) | none */
    speakerSource: text('speaker_source').notNull().default('none'),
    text: text('text').notNull(),
    /** Live recording: which chunk produced it (display order is chunk, then seq). */
    chunkIndex: integer('chunk_index'),
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('transcript_segments_label_uq').on(t.transcriptId, t.label), index('transcript_segments_order_idx').on(t.transcriptId, t.chunkIndex, t.seq)],
)

/** Prompt text versions, registered at start-up; an id can never change its text (checksum). */
export const aiPromptVersions = pgTable('ai_prompt_versions', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Non-secret AI settings in effect for a job (config/adaxai.yaml + env model overrides). */
export const aiSettingsSnapshots = pgTable('ai_settings_snapshots', {
  sha256: text('sha256').primaryKey(),
  settings: jsonb('settings').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Providers and models that have actually been called (or rule sets that ran). */
export const aiModels = pgTable(
  'ai_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** llm | stt | vision | rules */
    capability: text('capability').notNull(),
    firstUsedAt: timestamp('first_used_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_models_uq').on(t.provider, t.model, t.capability)],
)

/**
 * A requested piece of AI or rules processing (transcription, extraction,
 * note draft, recommendations, image analysis). Each attempt is an ai_run.
 * A failed job can be retried; an idempotency key stops double submission.
 */
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
    kind: text('kind').notNull(),
    /** running | succeeded | failed */
    status: text('status').notNull().default('running'),
    /** What the job worked on, e.g. { transcriptId } or { imageId } or { fileId, chunkIndex }. */
    input: jsonb('input').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    retryable: boolean('retryable').notNull().default(false),
    /** Short outcome summary, e.g. { facts: 7 } or { recommendations: 0, insufficientData: "..." }. No patient text. */
    summary: jsonb('summary'),
    idempotencyKey: text('idempotency_key'),
    dataOrigin: text('data_origin').notNull(),
    settingsSha256: text('settings_sha256').references(() => aiSettingsSnapshots.sha256),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('ai_jobs_encounter_idx').on(t.encounterId),
    index('ai_jobs_patient_idx').on(t.patientId),
    index('ai_jobs_created_idx').on(t.facilityId, t.createdAt),
    uniqueIndex('ai_jobs_idempotency_uq').on(t.createdBy, t.idempotencyKey),
    check('ai_jobs_status_check', sql`${t.status} in ('running', 'succeeded', 'failed')`),
    check('ai_jobs_origin_check', sql`${t.dataOrigin} in ('clinical', 'synthetic')`),
  ],
)

/**
 * A clinical fact extracted from a transcript. Never part of the record by
 * itself: the doctor accepts, edits, rejects or defers it.
 */
export const clinicalFacts = pgTable(
  'clinical_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id),
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => transcripts.id),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    category: text('category').notNull(),
    text: text('text').notNull(),
    /** Who the transcript attributes it to: patient_reported | clinician_stated | other_speaker */
    attribution: text('attribution').notNull(),
    /** stated | uncertain (unclear speech, hedged or ambiguous) */
    certainty: text('certainty').notNull(),
    uncertaintyReason: text('uncertainty_reason'),
    negated: boolean('negated').notNull().default(false),
    /** Normalised details used for record comparison, e.g. { substance } or { vitalKind, value, unit }. */
    attributes: jsonb('attributes').notNull().default(sql`'{}'::jsonb`),
    /** Review flags: uncertain, no_source, conflicts_with_record, not_in_record, speaker_mismatch, red_flag */
    flags: jsonb('flags').notNull().default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('pending'),
    finalText: text('final_text'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clinical_facts_encounter_idx').on(t.encounterId), index('clinical_facts_job_idx').on(t.jobId)],
)

/** Decision-support suggestions (rules or language model). Drafts only, until a doctor acts. */
export const aiRecommendations = pgTable(
  'ai_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    /** rules | llm */
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    /** routine | attention */
    urgency: text('urgency').notNull().default('routine'),
    text: text('text').notNull(),
    rationale: text('rationale').notNull(),
    /** [{ text }] what the system could not find. */
    missingInformation: jsonb('missing_information').notNull().default(sql`'[]'::jsonb`),
    /** True when none of the cited support could be verified. */
    unsupported: boolean('unsupported').notNull().default(false),
    instruction: text('instruction'),
    status: text('status').notNull().default('pending'),
    finalText: text('final_text'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_recommendations_encounter_idx').on(t.encounterId)],
)

/**
 * Provenance: links an AI output (fact, recommendation, image analysis) to the
 * transcript segment or record item that supports or conflicts with it, with
 * a snapshot of that source as it was. Append-only.
 */
export const aiEvidence = pgTable(
  'ai_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** supports | conflicts */
    relation: text('relation').notNull(),
    /** transcript_segment | allergy | observation | diagnosis | prescription_item | encounter_note | prior_encounter | thermal_capture | clinical_image | patient */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    /** Reference as shown to the model and the doctor, e.g. S3, A1, V2. */
    sourceRef: text('source_ref').notNull(),
    /** patient_reported | clinician_stated | record | device_measured | staff_measured | ai_generated */
    provenance: text('provenance').notNull(),
    excerpt: text('excerpt').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_evidence_subject_idx').on(t.subjectType, t.subjectId)],
)

/** Every doctor review action on an AI output. Append-only. */
export const aiReviewActions = pgTable(
  'ai_review_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** fact | recommendation | draft_item | image_analysis | routing_suggestion */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    action: text('action').notNull(),
    text: text('text'),
    reason: text('reason'),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_review_actions_subject_idx').on(t.subjectType, t.subjectId), index('ai_review_actions_encounter_idx').on(t.encounterId)],
)

/** A clinical photograph. The original file is kept unchanged; a metadata-free preview is shown. */
export const clinicalImages = pgTable(
  'clinical_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    previewFileId: uuid('preview_file_id')
      .notNull()
      .references(() => files.id),
    imageType: text('image_type').notNull(),
    /** upload | camera */
    source: text('source').notNull(),
    bodySite: text('body_site'),
    description: text('description'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** { format, hadExif, hadGps, ... } from the image service. */
    metadata: jsonb('metadata').notNull(),
    dataOrigin: text('data_origin').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clinical_images_patient_idx').on(t.patientId), index('clinical_images_encounter_idx').on(t.encounterId)],
)

/** AI description of an image: unverified until a doctor reviews it. */
export const imageAnalyses = pgTable(
  'image_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    imageId: uuid('image_id')
      .notNull()
      .references(() => clinicalImages.id),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id),
    /** { quality, observations[], limitations[], summary } */
    result: jsonb('result').notNull(),
    status: text('status').notNull().default('pending'),
    finalText: text('final_text'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('image_analyses_image_idx').on(t.imageId)],
)

/** Deterministic routing suggestion for a visit, and what staff did with it. */
export const routingSuggestions = pgTable(
  'routing_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    rulesVersion: text('rules_version').notNull(),
    /** { departmentId, departmentCode, priority, doctorId, missingIntake[], redFlags[], reasons[] } */
    suggestion: jsonb('suggestion').notNull(),
    /** pending | applied | overridden | dismissed | superseded */
    status: text('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewReason: text('review_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('routing_suggestions_visit_idx').on(t.visitId)],
)

/** Stored evaluation results (thermal dataset evaluation, AI review metrics). Append-only. */
export const evaluationRuns = pgTable(
  'evaluation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    /** thermal_dataset | ai_review */
    kind: text('kind').notNull(),
    subjectId: uuid('subject_id'),
    pipelineVersion: text('pipeline_version').notNull(),
    nonClinical: boolean('non_clinical').notNull(),
    metrics: jsonb('metrics').notNull(),
    reportMarkdown: text('report_markdown'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('evaluation_runs_kind_idx').on(t.facilityId, t.kind, t.createdAt)],
)

/** Which records went into which dataset export (internal ids stay here, never in the export). */
export const datasetMemberships = pgTable(
  'dataset_memberships',
  {
    exportId: uuid('export_id')
      .notNull()
      .references(() => thermalDatasetExports.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    exportLocalId: text('export_local_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.exportId, t.entityType, t.entityId] })],
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

/** De-identified dataset exports (the ZIP is a stored file). Never changed or deleted; evaluations are evaluation_runs. */
export const thermalDatasetExports = pgTable('thermal_dataset_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id),
  summary: jsonb('summary').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Devices: registry, assignment, gateway ingestion boundary, auscultation audio
// ---------------------------------------------------------------------------

/**
 * A registered device. `integration` states honestly how data gets in:
 * manual_upload (files uploaded by staff), gateway_api (a separate gateway
 * posts readings with the device token) or not_integrated.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    /** wearable_band | smart_stethoscope | thermal_camera | other */
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number').notNull(),
    /** active | retired */
    status: text('status').notNull().default('active'),
    integration: text('integration').notNull().default('not_integrated'),
    notes: text('notes'),
    /** SHA-256 of the gateway token; the token itself is shown once and never stored. */
    ingestTokenHash: text('ingest_token_hash'),
    tokenCreatedAt: timestamp('token_created_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('devices_serial_uq').on(t.facilityId, t.serialNumber), uniqueIndex('devices_token_uq').on(t.ingestTokenHash)],
)

/** Which patient a device is attached to. At most one open assignment per device. */
export const deviceAssignments = pgTable(
  'device_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    visitId: uuid('visit_id').references(() => visits.id),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: uuid('ended_by').references(() => users.id),
    endReason: text('end_reason'),
  },
  (t) => [uniqueIndex('device_assignments_one_open_uq').on(t.deviceId).where(sql`${t.endedAt} is null`), index('device_assignments_patient_idx').on(t.patientId)],
)

/** A stethoscope (auscultation) recording uploaded as a file. Append-only. */
export const auscultationRecordings = pgTable(
  'auscultation_recordings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    deviceId: uuid('device_id').references(() => devices.id),
    /** e.g. aortic, pulmonic, tricuspid, mitral, lung_left_upper ... */
    site: text('site').notNull(),
    note: text('note'),
    dataOrigin: text('data_origin').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auscultation_patient_idx').on(t.patientId)],
)

/**
 * Post-signing corrections. Append-only (triggers block UPDATE/DELETE); they
 * never change the signed record. Since migration 0019 the database numbers
 * each amendment (seq) and links it into a hash chain that starts at the
 * signed record's content_hash; older amendments have no hash.
 */
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
    seq: integer('seq'),
    prevHash: text('prev_hash'),
    contentHash: text('content_hash'),
    hashScheme: text('hash_scheme'),
  },
  (t) => [index('amendments_encounter_idx').on(t.encounterId), uniqueIndex('amendments_encounter_seq_uq').on(t.encounterId, t.seq)],
)

// ---------------------------------------------------------------------------
// Mana AI (patient-context questions) and AI text inserted into notes
// ---------------------------------------------------------------------------

/**
 * A doctor's question about one patient and Mana's answer. The record answer
 * (documented facts, explicit rules) and the cited source excerpts are
 * written once and never change; only the AI-generated part may be filled in
 * or retried while it is pending or failed (trigger, migration 0015).
 */
export const manaQuestions = pgTable(
  'mana_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: uuid('encounter_id').references(() => encounters.id),
    askedBy: uuid('asked_by')
      .notNull()
      .references(() => users.id),
    question: text('question').notNull(),
    intent: text('intent').notNull(),
    rulesVersion: text('rules_version').notNull(),
    /** Sections of documented statements, each citing source refs. */
    recordAnswer: jsonb('record_answer').notNull(),
    /** Snapshot of every record item the answer may cite (ManaSource[]). */
    sources: jsonb('sources').notNull(),
    /** pending | succeeded | failed | unavailable | consent_required | not_requested */
    generationStatus: text('generation_status').notNull(),
    generationReason: text('generation_reason'),
    generationRetryable: boolean('generation_retryable').notNull().default(false),
    /** { statements, notFound } from the language model, citations verified. */
    generated: jsonb('generated'),
    jobId: uuid('job_id').references(() => aiJobs.id),
    runId: uuid('run_id').references(() => aiRuns.id),
    idempotencyKey: text('idempotency_key'),
    dataOrigin: text('data_origin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mana_questions_patient_idx').on(t.patientId, t.createdAt),
    uniqueIndex('mana_questions_idempotency_uq').on(t.askedBy, t.idempotencyKey),
    check('mana_questions_generation_check', sql`${t.generationStatus} in ('pending', 'succeeded', 'failed', 'unavailable', 'consent_required', 'not_requested')`),
  ],
)

/**
 * AI-produced text a doctor inserted into a consultation note, with a
 * reference to the AI artifact it came from. Append-only; the signed snapshot
 * lists these references.
 */
export const noteInsertions = pgTable(
  'note_insertions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    section: text('section').notNull(),
    text: text('text').notNull(),
    /** draft_item | fact | recommendation | mana_answer | image_analysis */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** Provider / model / prompt or rules version of the artifact, as known when inserted. */
    producedBy: text('produced_by'),
    insertedBy: uuid('inserted_by')
      .notNull()
      .references(() => users.id),
    insertedAt: timestamp('inserted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('note_insertions_encounter_idx').on(t.encounterId),
    index('note_insertions_subject_idx').on(t.subjectType, t.subjectId),
    // The same text from the same artifact goes into a section once.
    uniqueIndex('note_insertions_once_uq').on(t.encounterId, t.subjectType, t.subjectId, t.section, sql`md5(${t.text})`),
  ],
)
