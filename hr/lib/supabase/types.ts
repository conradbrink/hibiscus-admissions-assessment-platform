/**
 * Database types for what the HR app reads and writes.
 *
 * Hand-maintained to match `supabase/migrations/*_hr_*.sql` (and the shared
 * staff and campus tables HR reads), in the shape `supabase gen types`
 * produces, the same way `web/lib/supabase/types.ts` is. A column added to an
 * HR migration is added here in the same commit, or the typecheck is lying.
 *
 * Only the tables HR touches are listed. The admissions tables are not, so an
 * HR module that reaches for `applications` fails to compile, which is the
 * separation working.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Generated = "id" | "created_at" | "updated_at";

type Rel<
  Name extends string,
  Col extends string,
  Ref extends string,
  OneToOne extends boolean = false,
> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: OneToOne;
  referencedRelation: Ref;
  referencedColumns: ["id"];
};

type TableOf<Row, Optional extends keyof Row = never, Rels extends unknown[] = []> = {
  Row: Row;
  Insert: Omit<Row, Extract<Generated | Optional, keyof Row>> &
    Partial<Pick<Row, Extract<Generated | Optional, keyof Row>>>;
  Update: Partial<Row>;
  Relationships: Rels;
};

// ---------------------------------------------------------------------------
// Shared with admissions (read only from HR)
// ---------------------------------------------------------------------------

export type StaffProfileRow = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PermissionRow = { code: string; label: string; sort_order: number };

export type RoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  campus_scoped: boolean;
  created_at: string;
  updated_at: string;
};

export type RolePermissionRow = { role_id: string; permission_code: string };
export type StaffRoleRow = { staff_id: string; role_id: string };
export type StaffCampusRow = { staff_id: string; campus_id: string };

export type Country = "BW" | "ZA";
export type Currency = "BWP" | "ZAR";

export type CampusRow = {
  id: string;
  code: string;
  name: string;
  descriptor: string | null;
  country: Country;
  currency: Currency;
  address: string | null;
  phone: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SettingRow = {
  key: string;
  value: Json;
  description: string;
  updated_at: string;
  updated_by: string | null;
};

// ---------------------------------------------------------------------------
// HR: foundations
// ---------------------------------------------------------------------------

export type HrSettingRow = {
  key: string;
  value: Json;
  label: string;
  updated_by: string | null;
  updated_at: string;
};

export type HrActorType = "staff" | "applicant" | "referee" | "employee" | "system";
export type HrSensitivity = "normal" | "compensation" | "compliance";

export type HrAuditLogRow = {
  id: number;
  actor_type: HrActorType;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  campus_id: string | null;
  hr_application_id: string | null;
  hr_employee_id: string | null;
  sensitivity: HrSensitivity;
  before: Json | null;
  after: Json | null;
  ip_hash: string | null;
  occurred_at: string;
};

export type HrJobStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type HrJobRow = {
  id: string;
  type: string;
  payload: Json;
  idempotency_key: string;
  run_after: string;
  precondition: Json | null;
  status: HrJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HrDrainRunRow = {
  id: string;
  ran_at: string;
  source: "schedule" | "request" | "manual";
  claimed: number;
  done: number;
  skipped: number;
  failed: number;
  duration_ms: number;
  detail: Json | null;
};

// ---------------------------------------------------------------------------
// HR: recruitment
// ---------------------------------------------------------------------------

export type Phase = "preschool" | "primary" | "secondary" | "general";
export type EmploymentType = "permanent" | "fixed_term" | "part_time" | "temporary";
export type VacancyStatus = "draft" | "published" | "closed" | "archived";

export type HrVacancyRow = {
  id: string;
  campus_id: string;
  slug: string;
  title: string;
  phase: Phase;
  subject: string | null;
  grade_range: string | null;
  employment_type: EmploymentType;
  summary: string;
  description: string;
  requirements: string[];
  salary_note: string | null;
  starts_on: string | null;
  closes_on: string | null;
  status: VacancyStatus;
  scoring_weights: Json | null;
  published_at: string | null;
  published_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationStatus = "draft" | "submitted" | "withdrawn" | "hired" | "anonymised";
export type PipelineStage = "review" | "shortlisted" | "unsuccessful";

export type HrApplicationRow = {
  id: string;
  reference: string;
  vacancy_id: string;
  campus_id: string;
  email: string;
  email_normalised: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  nationality: string | null;
  is_citizen: boolean | null;
  status: ApplicationStatus;
  stage: PipelineStage | null;
  stage_reason: string | null;
  stage_changed_at: string | null;
  stage_changed_by: string | null;
  sections_completed: string[];
  privacy_notice_version: string;
  consented_at: string;
  talent_pool_consent: boolean;
  integrity_notice_accepted_at: string | null;
  submitted_at: string | null;
  last_saved_at: string;
  withdrawn_at: string | null;
  retention_due_at: string | null;
  anonymised_at: string | null;
  communication_ai_band: number | null;
  communication_ai_rationale: string | null;
  communication_human_band: number | null;
  score_total: number | null;
  score_available: number | null;
  score_flags: string[];
  created_at: string;
  updated_at: string;
};

export type HrApplicationEventRow = {
  id: number;
  application_id: string;
  kind: string;
  detail: Json;
  actor_type: "staff" | "applicant" | "referee" | "system";
  actor_id: string | null;
  occurred_at: string;
};

export type HrApplicationNoteRow = {
  id: string;
  application_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

export type QualificationLevel =
  | "certificate"
  | "diploma"
  | "degree"
  | "honours"
  | "postgraduate_certificate"
  | "masters"
  | "doctorate"
  | "other";

export type HrApplicationQualificationRow = {
  id: string;
  application_id: string;
  level: QualificationLevel;
  title: string;
  institution: string;
  year_completed: number | null;
  country: string | null;
  is_teaching: boolean;
  sort_order: number;
};

export type HrApplicationEmploymentRow = {
  id: string;
  application_id: string;
  employer: string;
  role_title: string;
  is_school: boolean;
  phase_taught: string | null;
  start_on: string;
  end_on: string | null;
  reason_for_leaving: string | null;
  sort_order: number;
};

export type RegistrationBody = "SACE" | "BTPC" | "other" | "none";
export type PoliceClearance = "have" | "applied" | "none";

export type HrApplicationComplianceRow = {
  application_id: string;
  registration_body: RegistrationBody | null;
  registration_number: string | null;
  registration_expires_on: string | null;
  needs_permit: boolean | null;
  permit_type: string | null;
  permit_number: string | null;
  permit_expires_on: string | null;
  police_clearance: PoliceClearance | null;
  police_clearance_issued_on: string | null;
  child_protection_clear: boolean | null;
  criminal_record: boolean | null;
  criminal_record_detail: string | null;
  dismissed_before: boolean | null;
  dismissed_detail: string | null;
  safeguarding_concern: boolean | null;
  safeguarding_detail: string | null;
  declaration_name: string | null;
  declared_at: string | null;
  updated_at: string;
};

export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png";
export type ScanStatus = "not_scanned" | "clean" | "infected" | "error";
export type ApplicationDocumentKind = "cv" | "certificate" | "registration" | "permit" | "police_clearance" | "id" | "other";

export type HrApplicationDocumentRow = {
  id: string;
  application_id: string;
  kind: ApplicationDocumentKind;
  file_name: string;
  storage_path: string;
  mime: DocumentMime;
  size_bytes: number;
  sha256: string;
  scan_status: ScanStatus;
  uploaded_at: string;
};

export type Competency =
  | "safeguarding"
  | "pedagogy"
  | "classroom_management"
  | "inclusion"
  | "communication"
  | "professionalism"
  | "subject_knowledge"
  | "early_years_practice"
  | "assessment"
  | "teamwork";

export type HrQuestionBankRow = {
  id: string;
  code: string;
  phase: Phase;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type HrBankQuestionRow = {
  id: string;
  bank_id: string;
  code: string;
  kind: "core" | "pool";
  competency: Competency;
  prompt: string;
  guidance: string | null;
  rubric: Json;
  word_limit: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type HrVacancyQuestionRow = {
  id: string;
  vacancy_id: string;
  source_bank_question_id: string | null;
  prompt: string;
  competency: Competency;
  rubric: Json;
  word_limit: number;
  origin: "bank" | "ai" | "manual";
  ai_rationale: string | null;
  status: "draft" | "approved";
  approved_by: string | null;
  approved_at: string | null;
  sort_order: number;
  created_at: string;
};

export type AiLikelihood = "low" | "medium" | "high";

export type HrApplicationAnswerRow = {
  id: string;
  application_id: string;
  vacancy_question_id: string;
  answer_text: string;
  word_count: number;
  integrity: Json;
  ai_band: number | null;
  ai_rationale: string | null;
  ai_evidence: Json | null;
  ai_model: string | null;
  ai_marked_at: string | null;
  human_band: number | null;
  human_note: string | null;
  marked_by: string | null;
  marked_at: string | null;
  ai_likelihood: AiLikelihood | null;
  ai_likelihood_reasons: Json | null;
  ai_checked_at: string | null;
  duplicate_of_answer_id: string | null;
  duplicate_similarity: number | null;
  updated_at: string;
};

export type RefereeRelationship = "principal" | "line_manager" | "colleague" | "other";

export type HrRefereeRow = {
  id: string;
  application_id: string;
  full_name: string;
  relationship: RefereeRelationship;
  organisation: string;
  role_title: string | null;
  email: string;
  phone: string | null;
  is_most_recent_employer: boolean;
  sort_order: number;
};

export type ReferenceStatus = "pending" | "sent" | "opened" | "received" | "declined" | "expired";

export type HrReferenceRequestRow = {
  id: string;
  referee_id: string;
  application_id: string;
  status: ReferenceStatus;
  sent_at: string | null;
  opened_at: string | null;
  received_at: string | null;
  expires_at: string | null;
  reminders_sent: number;
  declined_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type Recommendation = "yes" | "with_reservations" | "no";
export type WouldReemploy = "yes" | "no" | "not_applicable";

export type HrReferenceResponseRow = {
  id: string;
  request_id: string;
  application_id: string;
  capacity: RefereeRelationship;
  known_from: string | null;
  known_to: string | null;
  role_and_dates_confirmed: boolean | null;
  role_and_dates_note: string | null;
  ratings: Json;
  concern: boolean;
  concern_detail: string | null;
  reason_for_leaving: string | null;
  would_reemploy: WouldReemploy;
  recommendation: Recommendation;
  comments: string | null;
  referee_name_confirmed: string;
  ip_hash: string | null;
  submitted_at: string;
};

export type HrApplicationScoreRow = {
  id: string;
  application_id: string;
  version: number;
  total: number;
  available: number;
  breakdown: Json;
  inputs: Json;
  flags: string[];
  computed_at: string;
};

export type InterviewMode = "in_person" | "video" | "phone";

export type HrInterviewRow = {
  id: string;
  application_id: string;
  campus_id: string;
  starts_at: string;
  ends_at: string;
  mode: InterviewMode;
  location: string | null;
  panel: string | null;
  status: "scheduled" | "completed" | "cancelled";
  ics_uid: string;
  ics_sequence: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// HR: communications and tokens
// ---------------------------------------------------------------------------

export type TemplateAudience = "applicant" | "referee" | "employee" | "staff";

export type HrEmailTemplateRow = {
  id: string;
  key: string;
  version: number;
  audience: TemplateAudience;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  body_text: string;
  allowed_variables: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailStatus = "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "failed";

export type HrEmailMessageRow = {
  id: string;
  hr_application_id: string | null;
  hr_reference_request_id: string | null;
  hr_employee_id: string | null;
  template_key: string | null;
  template_version: number | null;
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string;
  provider: string;
  provider_message_id: string | null;
  status: EmailStatus;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  bounce_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type HrTokenPurpose = "application" | "reference" | "payslip";

export type HrAccessTokenRow = {
  id: string;
  purpose: HrTokenPurpose;
  hr_application_id: string | null;
  hr_reference_request_id: string | null;
  hr_payslip_id: string | null;
  token_hash: string;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_reason: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// The Database type supabase-js reads
// ---------------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      staff_profiles: TableOf<StaffProfileRow, "is_active">;
      permissions: TableOf<PermissionRow, "sort_order">;
      roles: TableOf<RoleRow, "description" | "is_system" | "campus_scoped">;
      role_permissions: TableOf<RolePermissionRow, never, [Rel<"role_permissions_role_id_fkey", "role_id", "roles">]>;
      staff_roles: TableOf<
        StaffRoleRow,
        never,
        [Rel<"staff_roles_staff_id_fkey", "staff_id", "staff_profiles">, Rel<"staff_roles_role_id_fkey", "role_id", "roles">]
      >;
      staff_campuses: TableOf<
        StaffCampusRow,
        never,
        [
          Rel<"staff_campuses_staff_id_fkey", "staff_id", "staff_profiles">,
          Rel<"staff_campuses_campus_id_fkey", "campus_id", "campuses">,
        ]
      >;
      campuses: TableOf<CampusRow, "descriptor" | "address" | "phone" | "sort_order" | "is_active">;
      settings: TableOf<SettingRow, "updated_by">;

      hr_settings: TableOf<HrSettingRow, "updated_by">;
      hr_audit_log: TableOf<
        HrAuditLogRow,
        "actor_id" | "actor_label" | "entity_id" | "campus_id" | "hr_application_id" | "hr_employee_id" | "sensitivity" | "before" | "after" | "ip_hash" | "occurred_at"
      >;
      hr_jobs: TableOf<
        HrJobRow,
        "payload" | "run_after" | "precondition" | "status" | "attempts" | "max_attempts" | "last_error" | "locked_at" | "locked_by" | "completed_at"
      >;
      hr_drain_runs: TableOf<HrDrainRunRow, "ran_at" | "claimed" | "done" | "skipped" | "failed" | "duration_ms" | "detail">;

      hr_vacancies: TableOf<
        HrVacancyRow,
        | "subject"
        | "grade_range"
        | "employment_type"
        | "summary"
        | "description"
        | "requirements"
        | "salary_note"
        | "starts_on"
        | "closes_on"
        | "status"
        | "scoring_weights"
        | "published_at"
        | "published_by"
        | "created_by",
        [Rel<"hr_vacancies_campus_id_fkey", "campus_id", "campuses">]
      >;
      hr_applications: TableOf<
        HrApplicationRow,
        | "reference"
        | "phone"
        | "nationality"
        | "is_citizen"
        | "status"
        | "stage"
        | "stage_reason"
        | "stage_changed_at"
        | "stage_changed_by"
        | "sections_completed"
        | "talent_pool_consent"
        | "integrity_notice_accepted_at"
        | "submitted_at"
        | "last_saved_at"
        | "withdrawn_at"
        | "retention_due_at"
        | "anonymised_at"
        | "communication_ai_band"
        | "communication_ai_rationale"
        | "communication_human_band"
        | "score_total"
        | "score_available"
        | "score_flags",
        [
          Rel<"hr_applications_vacancy_id_fkey", "vacancy_id", "hr_vacancies">,
          Rel<"hr_applications_campus_id_fkey", "campus_id", "campuses">,
        ]
      >;
      hr_application_events: TableOf<HrApplicationEventRow, "detail" | "actor_id" | "occurred_at">;
      hr_application_notes: TableOf<HrApplicationNoteRow, "author_id">;
      hr_application_qualifications: TableOf<HrApplicationQualificationRow, "year_completed" | "country" | "is_teaching" | "sort_order">;
      hr_application_employment: TableOf<
        HrApplicationEmploymentRow,
        "is_school" | "phase_taught" | "end_on" | "reason_for_leaving" | "sort_order"
      >;
      hr_application_compliance: TableOf<
        HrApplicationComplianceRow,
        Exclude<keyof HrApplicationComplianceRow, "application_id">
      >;
      hr_application_documents: TableOf<HrApplicationDocumentRow, "scan_status" | "uploaded_at">;
      hr_question_banks: TableOf<HrQuestionBankRow, "description" | "is_active">;
      hr_bank_questions: TableOf<HrBankQuestionRow, "guidance" | "word_limit" | "sort_order" | "is_active">;
      hr_vacancy_questions: TableOf<
        HrVacancyQuestionRow,
        "source_bank_question_id" | "word_limit" | "ai_rationale" | "status" | "approved_by" | "approved_at" | "sort_order",
        [Rel<"hr_vacancy_questions_vacancy_id_fkey", "vacancy_id", "hr_vacancies">]
      >;
      hr_application_answers: TableOf<
        HrApplicationAnswerRow,
        Exclude<keyof HrApplicationAnswerRow, "application_id" | "vacancy_question_id">,
        [Rel<"hr_application_answers_vacancy_question_id_fkey", "vacancy_question_id", "hr_vacancy_questions">]
      >;
      hr_referees: TableOf<HrRefereeRow, "role_title" | "phone" | "is_most_recent_employer" | "sort_order">;
      hr_reference_requests: TableOf<
        HrReferenceRequestRow,
        "status" | "sent_at" | "opened_at" | "received_at" | "expires_at" | "reminders_sent" | "declined_reason",
        [
          Rel<"hr_reference_requests_referee_id_fkey", "referee_id", "hr_referees", true>,
          Rel<"hr_reference_requests_application_id_fkey", "application_id", "hr_applications">,
        ]
      >;
      hr_reference_responses: TableOf<
        HrReferenceResponseRow,
        | "known_from"
        | "known_to"
        | "role_and_dates_confirmed"
        | "role_and_dates_note"
        | "concern_detail"
        | "reason_for_leaving"
        | "comments"
        | "ip_hash"
        | "submitted_at",
        [Rel<"hr_reference_responses_request_id_fkey", "request_id", "hr_reference_requests", true>]
      >;
      hr_application_scores: TableOf<HrApplicationScoreRow, "flags" | "computed_at">;
      hr_interviews: TableOf<
        HrInterviewRow,
        "mode" | "location" | "panel" | "status" | "ics_uid" | "ics_sequence" | "notes" | "created_by"
      >;

      hr_email_templates: TableOf<HrEmailTemplateRow, "version" | "description" | "allowed_variables" | "is_active" | "created_by">;
      hr_email_messages: TableOf<
        HrEmailMessageRow,
        | "hr_application_id"
        | "hr_reference_request_id"
        | "hr_employee_id"
        | "template_key"
        | "template_version"
        | "provider_message_id"
        | "status"
        | "error"
        | "sent_at"
        | "delivered_at"
        | "opened_at"
        | "bounced_at"
        | "bounce_reason"
      >;
      hr_access_tokens: TableOf<
        HrAccessTokenRow,
        "hr_application_id" | "hr_reference_request_id" | "hr_payslip_id" | "max_uses" | "use_count" | "revoked_at" | "created_reason"
      >;
    };
    Views: Record<string, never>;
    Functions: {
      has_permission: { Args: { p_code: string }; Returns: boolean };
      hr_has_strict: { Args: { p_code: string }; Returns: boolean };
      my_permissions: { Args: Record<string, never>; Returns: string[] };
      can_access_campus: { Args: { p_campus_id: string }; Returns: boolean };
      consume_rate_limit: {
        Args: { p_bucket: string; p_subject: string; p_limit: number; p_window_seconds: number; p_cost?: number };
        Returns: Json;
      };
      hr_claim_jobs: { Args: { p_worker: string; p_limit?: number }; Returns: HrJobRow[] };
      hr_consume_token: {
        Args: { p_token_hash: string; p_ip_hash: string | null; p_user_agent: string | null };
        Returns: {
          outcome: "ok" | "expired" | "revoked" | "exhausted" | "unknown";
          purpose: HrTokenPurpose | null;
          hr_application_id: string | null;
          hr_reference_request_id: string | null;
          hr_payslip_id: string | null;
          token_id: string | null;
        }[];
      };
      hr_commit_stage: {
        Args: {
          p_application_id: string;
          p_expected_stage: PipelineStage | null;
          p_to_stage: PipelineStage;
          p_reason: string | null;
          p_actor_id: string | null;
          p_to_status?: "hired" | "withdrawn" | null;
        };
        Returns: HrApplicationRow;
      };
      hr_anonymise_applicant: { Args: { p_application_id: string }; Returns: boolean };
      hr_similar_answers: {
        Args: { p_answer_id: string; p_threshold?: number };
        Returns: { answer_id: string; application_id: string; similarity: number }[];
      };
      hr_publish_email_template: {
        Args: { p_key: string; p_subject: string; p_body_html: string; p_body_text: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
