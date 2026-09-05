/**
 * Database types for the Phase 1 schema.
 *
 * Hand-maintained to match `supabase/migrations`, in the shape `supabase gen
 * types` produces, so the switch to generated types once a project exists is
 * a file swap. Until then: a column added to a migration is added here in the
 * same commit, or the typecheck is lying.
 *
 * Insert and Update are derived from Row rather than written out, which keeps
 * the three in step. `Generated` lists the columns the database fills in.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Generated = "id" | "created_at" | "updated_at";

/**
 * A foreign key, in the shape supabase-js reads to type embedded selects
 * such as `applications(contacts(*))`. Names follow Postgres's default
 * `<table>_<column>_fkey`, which is what the migrations produce.
 */
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
// Row types
// ---------------------------------------------------------------------------

export type ApplicationStatus =
  | "new_enquiry"
  | "visit_booked"
  | "callback_requested"
  | "assessment_booked"
  | "no_show"
  | "assessment_in_progress"
  | "assessment_completed"
  | "awaiting_decision"
  | "staff_review"
  | "approved"
  | "waitlisted"
  | "declined"
  | "offer_draft"
  | "offer_pending_approval"
  | "offer_sent"
  | "offer_expired"
  | "offer_declined"
  | "offer_accepted"
  | "payment_required"
  | "payment_processing"
  | "paid"
  | "registration_incomplete"
  | "registration_complete"
  | "enrolled"
  | "withdrawn";

export type EntryRoute = "assessment" | "visit" | "callback";
export type ApplicationSource =
  | "website"
  | "staff"
  | "referral"
  | "walk_in"
  | "phone"
  | "other";
export type ActorType = "staff" | "parent" | "system";
export type GradePhase = "pre_school" | "primary" | "secondary";
export type SessionKind = "assessment" | "visit";
export type BookingStatus =
  | "booked"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "no_show"
  | "cancelled"
  | "rescheduled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "open" | "done" | "cancelled";
export type TokenPurpose =
  | "next_step"
  | "booking"
  | "results"
  | "offer"
  | "payment"
  | "registration";
export type EmailStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "failed";
export type JobStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type StaffProfileRow = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PermissionRow = {
  code: string;
  label: string;
  sort_order: number;
};

export type RoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  /** Holders see nothing until assigned campuses in staff_campuses. */
  campus_scoped: boolean;
  created_at: string;
  updated_at: string;
};

export type RolePermissionRow = {
  role_id: string;
  permission_code: string;
};

export type StaffRoleRow = {
  staff_id: string;
  role_id: string;
};

export type StaffCampusRow = {
  staff_id: string;
  campus_id: string;
};

export type AuditLogRow = {
  id: number;
  actor_type: ActorType;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  application_id: string | null;
  before: Json | null;
  after: Json | null;
  ip_hash: string | null;
  occurred_at: string;
};

export type CampusRow = {
  id: string;
  code: string;
  name: string;
  descriptor: string | null;
  country: "BW" | "ZA";
  currency: "BWP" | "ZAR";
  address: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type GradeRow = {
  id: string;
  code: string;
  name: string;
  phase: GradePhase;
  sort_order: number;
  age_turning: number | null;
  requires_assessment: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CampusGradeRow = {
  campus_id: string;
  grade_id: string;
  is_active: boolean;
  /** Places per academic year. Null is unlimited. */
  capacity: number | null;
};

export type SubjectRow = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CompetencyRow = {
  id: string;
  subject_id: string;
  code: string;
  name: string;
  focus_label: string | null;
  reportable: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AcademicYearRow = {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  age_cutoff_on: string;
  is_current: boolean;
  created_at: string;
  updated_at: string;
};

export type IntakeRow = {
  id: string;
  academic_year_id: string;
  term: number;
  label: string;
  starts_on: string;
  is_open: boolean;
  sort_order: number;
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

export type ContactRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  email_normalised: string;
  mobile: string | null;
  mobile_normalised: string | null;
  created_at: string;
  updated_at: string;
};

export type ReferenceCounterRow = {
  year: number;
  next_value: number;
};

export type ApplicationRow = {
  id: string;
  reference: string;
  contact_id: string;
  child_first_name: string;
  child_last_name: string;
  child_date_of_birth: string;
  child_preferred_name: string | null;
  campus_id: string;
  grade_id: string;
  recommended_grade_id: string | null;
  intake_id: string;
  requires_assessment: boolean;
  current_school: string | null;
  current_grade: string | null;
  status: ApplicationStatus;
  status_changed_at: string;
  entry_route: EntryRoute;
  source: ApplicationSource;
  owner_staff_id: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  withdrawn_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationGuardianRow = {
  application_id: string;
  contact_id: string;
  relationship: "mother" | "father" | "parent" | "guardian" | "grandparent" | "other";
  is_primary: boolean;
  created_at: string;
};

export type ApplicationEventRow = {
  id: number;
  application_id: string;
  type: string;
  actor_type: ActorType;
  actor_id: string | null;
  summary: string;
  payload: Json;
  occurred_at: string;
};

export type TaskRow = {
  id: string;
  application_id: string | null;
  campus_id: string | null;
  type: string;
  title: string;
  details: string | null;
  assignee_staff_id: string | null;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  created_by_type: "staff" | "system";
  created_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteRow = {
  id: string;
  application_id: string;
  author_staff_id: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type AccessTokenRow = {
  id: string;
  application_id: string;
  purpose: TokenPurpose;
  token_hash: string;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_reason: string | null;
  created_at: string;
};

export type TokenUseRow = {
  id: number;
  token_id: string;
  used_at: string;
  ip_hash: string | null;
  user_agent: string | null;
  outcome: "ok" | "expired" | "revoked" | "exhausted";
};

export type RateLimitRow = {
  bucket: string;
  subject: string;
  window_start: string;
  count: number;
};

export type SessionRow = {
  id: string;
  kind: SessionKind;
  campus_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  min_grade_sort: number | null;
  max_grade_sort: number | null;
  assessor_staff_id: string | null;
  location: string | null;
  is_published: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingRow = {
  id: string;
  application_id: string;
  session_id: string;
  kind: SessionKind;
  status: BookingStatus;
  booked_at: string;
  checked_in_at: string | null;
  checked_in_by: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  rescheduled_to_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CallbackRequestRow = {
  id: string;
  application_id: string;
  preferred_time: string | null;
  message: string | null;
  created_at: string;
};

export type EmailTemplateRow = {
  id: string;
  key: string;
  version: number;
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

export type EmailMessageRow = {
  id: string;
  application_id: string | null;
  contact_id: string | null;
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
  clicked_at: string | null;
  bounced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobRow = {
  id: string;
  type: string;
  payload: Json;
  application_id: string | null;
  idempotency_key: string;
  run_after: string;
  precondition: Json | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Phase 2: question bank and templates
// ---------------------------------------------------------------------------

export type BankStatus = "draft" | "active" | "retired";
export type QuestionType =
  | "single_choice"
  | "multi_select"
  | "numeric"
  | "short_text"
  | "matching"
  | "ordering"
  | "extended_text";
export type QuestionStatus = "draft" | "active" | "retired";
export type SectionSelection = "fixed" | "random";
export type BenchmarkScope = "overall" | "subject" | "competency";
export type BenchmarkBand = "below" | "approaching" | "meeting" | "exceeding";

export type QuestionBankRow = {
  id: string;
  name: string;
  description: string | null;
  status: BankStatus;
  is_sample: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PassageRow = {
  id: string;
  bank_id: string;
  title: string;
  body: string;
  media_path: string | null;
  created_at: string;
  updated_at: string;
};

export type RubricBand = { key: string; label: string; min_marks: number; descriptor: string };

export type RubricRow = {
  id: string;
  name: string;
  competency_id: string;
  max_marks: number;
  bands: Json;
  created_at: string;
  updated_at: string;
};

export type QuestionRow = {
  id: string;
  bank_id: string;
  competency_id: string;
  passage_id: string | null;
  type: QuestionType;
  stem: string;
  stem_media_path: string | null;
  marks: number;
  difficulty: number;
  grade_sort_min: number | null;
  grade_sort_max: number | null;
  status: QuestionStatus;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QuestionOptionRow = {
  id: string;
  question_id: string;
  position: number;
  label: string;
  media_path: string | null;
  side: "left" | "right" | null;
};

export type QuestionAnswerRow = {
  question_id: string;
  answer: Json | null;
  partial_credit: boolean;
  rubric_id: string | null;
  updated_at: string;
};

export type AssessmentTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  grade_sort_min: number;
  grade_sort_max: number;
  campus_id: string | null;
  time_limit_minutes: number;
  status: QuestionStatus;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateSectionRow = {
  id: string;
  template_id: string;
  position: number;
  title: string;
  subject_id: string;
  instructions: string | null;
  time_limit_minutes: number | null;
  selection: SectionSelection;
  random_count: number | null;
  random_difficulty_mix: Json | null;
  practice_question_id: string | null;
};

export type TemplateSectionQuestionRow = {
  section_id: string;
  question_id: string;
  position: number;
};

export type BenchmarkRow = {
  id: string;
  grade_sort_min: number | null;
  grade_sort_max: number | null;
  scope: BenchmarkScope;
  scope_id: string | null;
  bands: Json;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Phase 2: sittings
// ---------------------------------------------------------------------------

export type AttemptStatus = "ready" | "in_progress" | "submitted" | "marked" | "abandoned";
export type MarkingStatus = "pending" | "auto_marked" | "awaiting_rubric" | "complete";
export type MarkingMethod = "auto" | "rubric";

export type AssessmentFormRow = {
  id: string;
  application_id: string;
  template_id: string;
  template_version: number;
  created_at: string;
};

export type FormQuestionRow = {
  id: string;
  form_id: string;
  section_position: number;
  section_title: string;
  section_instructions: string | null;
  section_time_limit_seconds: number | null;
  is_practice: boolean;
  position: number;
  question_id: string | null;
  question_version: number;
  competency_id: string;
  type: QuestionType;
  stem: string;
  stem_media_path: string | null;
  passage_snapshot: Json | null;
  options: Json;
  marks: number;
  rubric_snapshot: Json | null;
};

export type FormAnswerKeyRow = {
  form_question_id: string;
  answer: Json | null;
  partial_credit: boolean;
};

export type AttemptRow = {
  id: string;
  application_id: string;
  booking_id: string;
  form_id: string;
  status: AttemptStatus;
  marking_status: MarkingStatus;
  launched_by: string | null;
  launched_at: string;
  started_at: string | null;
  submitted_at: string | null;
  auto_submitted: boolean;
  time_limit_seconds: number;
  time_multiplier: number;
  accommodation_note: string | null;
  expires_at: string | null;
  device_user_agent: string | null;
  created_at: string;
  updated_at: string;
};

export type KioskCodeRow = {
  id: string;
  attempt_id: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type AttemptResponseRow = {
  id: string;
  attempt_id: string;
  form_question_id: string;
  response: Json;
  answered_at: string;
  is_correct: boolean | null;
  marks_awarded: number | null;
  marking_method: MarkingMethod | null;
  marked_by: string | null;
  marked_at: string | null;
  ai_suggestion: Json | null;
};

export type AttemptScoreRow = {
  attempt_id: string;
  scope: BenchmarkScope;
  scope_id: string | null;
  raw: number;
  max: number;
  percent: number;
  band: BenchmarkBand;
  computed_at: string;
};

// ---------------------------------------------------------------------------
// Phase 2: decisions, profiles, offers
// ---------------------------------------------------------------------------

export type DecisionOutcome = "approved" | "waitlisted" | "declined" | "staff_review";
export type DecidedBy = "rules" | "staff";
export type RulesetStatus = "draft" | "active" | "superseded";
export type RuleSeverity = "hard_fail" | "review";
export type RuleOperator = ">=" | ">" | "<=" | "<";
export type NarrativeSource = "ai" | "fallback";
export type ValidationStatus = "passed" | "failed" | "not_run";
export type OfferStatus =
  | "draft"
  | "pending_approval"
  | "sent"
  | "viewed"
  | "expired"
  | "withdrawn"
  | "accepted"
  | "declined";
export type FeeCode = "registration" | "admission" | "tuition_annual" | "tuition_term";
export type FeeScheduleStatus = "draft" | "active";

export type AdmissionRulesetRow = {
  id: string;
  name: string;
  description: string | null;
  grade_sort_min: number | null;
  grade_sort_max: number | null;
  campus_id: string | null;
  version: number;
  status: RulesetStatus;
  activated_at: string | null;
  activated_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdmissionRuleRow = {
  id: string;
  ruleset_id: string;
  scope: BenchmarkScope;
  scope_id: string | null;
  operator: RuleOperator;
  threshold: number;
  severity: RuleSeverity;
  label: string;
  position: number;
};

export type AdmissionDecisionRow = {
  id: string;
  application_id: string;
  attempt_id: string | null;
  ruleset_id: string | null;
  ruleset_version: number | null;
  inputs: Json;
  computed_outcome: DecisionOutcome;
  final_outcome: DecisionOutcome;
  decided_by: DecidedBy;
  staff_id: string | null;
  override_reason: string | null;
  decided_at: string;
};

export type LearningProfileRow = {
  id: string;
  attempt_id: string;
  application_id: string;
  computed: Json;
  narrative: Json;
  narrative_source: NarrativeSource;
  ai_model: string | null;
  prompt_version: string | null;
  validation_status: ValidationStatus;
  validation_errors: Json | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FeeScheduleRow = {
  id: string;
  campus_id: string;
  academic_year_id: string;
  grade_sort_min: number | null;
  grade_sort_max: number | null;
  currency: "BWP" | "ZAR";
  status: FeeScheduleStatus;
  name: string;
  created_at: string;
  updated_at: string;
};

export type FeeLineRow = {
  id: string;
  schedule_id: string;
  code: FeeCode;
  label: string;
  amount_minor: number;
  payable_at_acceptance: boolean;
  position: number;
};

export type OfferTemplateRow = {
  id: string;
  key: string;
  version: number;
  name: string;
  description: string | null;
  body_html: string;
  terms_html: string;
  allowed_variables: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OfferRow = {
  id: string;
  application_id: string;
  template_id: string;
  template_version: number;
  fee_schedule_id: string | null;
  currency: "BWP" | "ZAR";
  variables: Json;
  rendered_html: string;
  terms_html: string;
  fees: Json;
  start_date: string | null;
  expires_at: string | null;
  status: OfferStatus;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  conditions: string | null;
  withdrawn_reason: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Phase 3: acceptance, payments
// ---------------------------------------------------------------------------

export type OfferDecision = "accepted" | "declined";
export type PaymentRequestStatus = "required" | "processing" | "paid" | "failed" | "refunded" | "partially_paid" | "cancelled";
export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "expired" | "refunded";
export type PaymentMethod = "online" | "eft";
export type PaymentProviderName = "dev" | "dpo" | "bank";

export type OfferAcceptanceRow = {
  id: string;
  application_id: string;
  offer_id: string;
  template_id: string;
  template_version: number;
  decision: OfferDecision;
  terms_accepted: boolean;
  terms_hash: string;
  fees: Json;
  decline_reason: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  decided_at: string;
  created_at: string;
};

export type PaymentRequestRow = {
  id: string;
  application_id: string;
  offer_id: string;
  acceptance_id: string;
  currency: "BWP" | "ZAR";
  amount_minor: number;
  lines: Json;
  paid_minor: number;
  status: PaymentRequestStatus;
  due_at: string;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: string;
  payment_request_id: string;
  application_id: string;
  method: PaymentMethod;
  provider: PaymentProviderName;
  provider_ref: string | null;
  company_ref: string;
  status: PaymentStatus;
  amount_minor: number;
  currency: "BWP" | "ZAR";
  approval_code: string | null;
  expires_at: string | null;
  verify_attempts: number;
  last_verified_at: string | null;
  raw_response: Json | null;
  failure_reason: string | null;
  bank_reference: string | null;
  received_on: string | null;
  recorded_by: string | null;
  note: string | null;
  refunded_at: string | null;
  refunded_by: string | null;
  refund_note: string | null;
  created_at: string;
  updated_at: string;
};

export type BankInstructionRow = {
  id: string;
  currency: "BWP" | "ZAR";
  campus_id: string | null;
  body_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FunnelEventRow = {
  id: number;
  session_key: string;
  application_id: string | null;
  step: string;
  campus_id: string | null;
  grade_id: string | null;
  elapsed_ms: number | null;
  occurred_at: string;
};

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      staff_profiles: TableOf<StaffProfileRow, "is_active">;
      permissions: TableOf<PermissionRow, "sort_order">;
      roles: TableOf<RoleRow, "description" | "is_system" | "campus_scoped">;
      role_permissions: TableOf<
        RolePermissionRow,
        never,
        [Rel<"role_permissions_role_id_fkey", "role_id", "roles">]
      >;
      staff_roles: TableOf<
        StaffRoleRow,
        never,
        [
          Rel<"staff_roles_staff_id_fkey", "staff_id", "staff_profiles">,
          Rel<"staff_roles_role_id_fkey", "role_id", "roles">,
        ]
      >;
      staff_campuses: TableOf<
        StaffCampusRow,
        never,
        [
          Rel<"staff_campuses_staff_id_fkey", "staff_id", "staff_profiles">,
          Rel<"staff_campuses_campus_id_fkey", "campus_id", "campuses">,
        ]
      >;
      audit_log: TableOf<
        AuditLogRow,
        | "actor_id"
        | "actor_label"
        | "entity_id"
        | "application_id"
        | "before"
        | "after"
        | "ip_hash"
        | "occurred_at"
      >;
      campuses: TableOf<
        CampusRow,
        "descriptor" | "country" | "currency" | "address" | "sort_order" | "is_active"
      >;
      grades: TableOf<GradeRow, "age_turning" | "requires_assessment" | "is_active">;
      campus_grades: TableOf<
        CampusGradeRow,
        "is_active" | "capacity",
        [
          Rel<"campus_grades_campus_id_fkey", "campus_id", "campuses">,
          Rel<"campus_grades_grade_id_fkey", "grade_id", "grades">,
        ]
      >;
      subjects: TableOf<SubjectRow, "sort_order" | "is_active">;
      competencies: TableOf<
        CompetencyRow,
        "focus_label" | "reportable" | "sort_order" | "is_active",
        [Rel<"competencies_subject_id_fkey", "subject_id", "subjects">]
      >;
      academic_years: TableOf<AcademicYearRow, "is_current">;
      intakes: TableOf<
        IntakeRow,
        "is_open" | "sort_order",
        [Rel<"intakes_academic_year_id_fkey", "academic_year_id", "academic_years">]
      >;
      settings: TableOf<
        SettingRow,
        "updated_by",
        [Rel<"settings_updated_by_fkey", "updated_by", "staff_profiles">]
      >;
      contacts: TableOf<ContactRow, "mobile" | "mobile_normalised">;
      reference_counters: TableOf<ReferenceCounterRow, "next_value">;
      applications: TableOf<
        ApplicationRow,
        | "child_preferred_name"
        | "recommended_grade_id"
        | "current_school"
        | "current_grade"
        | "status"
        | "status_changed_at"
        | "source"
        | "owner_staff_id"
        | "next_action"
        | "next_action_due_at"
        | "withdrawn_reason",
        [
          Rel<"applications_contact_id_fkey", "contact_id", "contacts">,
          Rel<"applications_campus_id_fkey", "campus_id", "campuses">,
          Rel<"applications_grade_id_fkey", "grade_id", "grades">,
          Rel<"applications_recommended_grade_id_fkey", "recommended_grade_id", "grades">,
          Rel<"applications_intake_id_fkey", "intake_id", "intakes">,
          Rel<"applications_owner_staff_id_fkey", "owner_staff_id", "staff_profiles">,
        ]
      >;
      application_guardians: TableOf<
        ApplicationGuardianRow,
        "relationship" | "is_primary",
        [
          Rel<"application_guardians_application_id_fkey", "application_id", "applications">,
          Rel<"application_guardians_contact_id_fkey", "contact_id", "contacts">,
        ]
      >;
      application_events: TableOf<
        ApplicationEventRow,
        "actor_id" | "payload" | "occurred_at",
        [Rel<"application_events_application_id_fkey", "application_id", "applications">]
      >;
      tasks: TableOf<
        TaskRow,
        | "application_id"
        | "campus_id"
        | "details"
        | "assignee_staff_id"
        | "due_at"
        | "priority"
        | "status"
        | "created_by_type"
        | "created_by"
        | "resolved_at"
        | "resolved_by"
        | "resolution_note",
        [
          Rel<"tasks_application_id_fkey", "application_id", "applications">,
          Rel<"tasks_campus_id_fkey", "campus_id", "campuses">,
          Rel<"tasks_assignee_staff_id_fkey", "assignee_staff_id", "staff_profiles">,
          Rel<"tasks_created_by_fkey", "created_by", "staff_profiles">,
          Rel<"tasks_resolved_by_fkey", "resolved_by", "staff_profiles">,
        ]
      >;
      notes: TableOf<
        NoteRow,
        "is_pinned",
        [
          Rel<"notes_application_id_fkey", "application_id", "applications">,
          Rel<"notes_author_staff_id_fkey", "author_staff_id", "staff_profiles">,
        ]
      >;
      access_tokens: TableOf<
        AccessTokenRow,
        "max_uses" | "use_count" | "revoked_at" | "created_reason",
        [Rel<"access_tokens_application_id_fkey", "application_id", "applications">]
      >;
      token_uses: TableOf<
        TokenUseRow,
        "used_at" | "ip_hash" | "user_agent",
        [Rel<"token_uses_token_id_fkey", "token_id", "access_tokens">]
      >;
      rate_limits: TableOf<RateLimitRow, "count">;
      sessions: TableOf<
        SessionRow,
        | "capacity"
        | "min_grade_sort"
        | "max_grade_sort"
        | "assessor_staff_id"
        | "location"
        | "is_published"
        | "notes"
        | "created_by",
        [
          Rel<"sessions_campus_id_fkey", "campus_id", "campuses">,
          Rel<"sessions_assessor_staff_id_fkey", "assessor_staff_id", "staff_profiles">,
          Rel<"sessions_created_by_fkey", "created_by", "staff_profiles">,
        ]
      >;
      bookings: TableOf<
        BookingRow,
        | "status"
        | "booked_at"
        | "checked_in_at"
        | "checked_in_by"
        | "completed_at"
        | "cancelled_at"
        | "cancel_reason"
        | "rescheduled_to_id",
        [
          Rel<"bookings_application_id_fkey", "application_id", "applications">,
          Rel<"bookings_session_id_fkey", "session_id", "sessions">,
          Rel<"bookings_checked_in_by_fkey", "checked_in_by", "staff_profiles">,
          Rel<"bookings_rescheduled_to_id_fkey", "rescheduled_to_id", "bookings">,
        ]
      >;
      callback_requests: TableOf<
        CallbackRequestRow,
        "preferred_time" | "message",
        [Rel<"callback_requests_application_id_fkey", "application_id", "applications">]
      >;
      email_templates: TableOf<
        EmailTemplateRow,
        "version" | "description" | "allowed_variables" | "is_active" | "created_by",
        [Rel<"email_templates_created_by_fkey", "created_by", "staff_profiles">]
      >;
      email_messages: TableOf<
        EmailMessageRow,
        | "application_id"
        | "contact_id"
        | "template_key"
        | "template_version"
        | "provider_message_id"
        | "status"
        | "error"
        | "sent_at"
        | "delivered_at"
        | "opened_at"
        | "clicked_at"
        | "bounced_at",
        [
          Rel<"email_messages_application_id_fkey", "application_id", "applications">,
          Rel<"email_messages_contact_id_fkey", "contact_id", "contacts">,
        ]
      >;
      jobs: TableOf<
        JobRow,
        | "payload"
        | "application_id"
        | "run_after"
        | "precondition"
        | "status"
        | "attempts"
        | "max_attempts"
        | "last_error"
        | "locked_at"
        | "locked_by"
        | "completed_at",
        [Rel<"jobs_application_id_fkey", "application_id", "applications">]
      >;
      question_banks: TableOf<
        QuestionBankRow,
        "description" | "status" | "is_sample" | "created_by",
        [Rel<"question_banks_created_by_fkey", "created_by", "staff_profiles">]
      >;
      passages: TableOf<
        PassageRow,
        "media_path",
        [Rel<"passages_bank_id_fkey", "bank_id", "question_banks">]
      >;
      rubrics: TableOf<
        RubricRow,
        "bands",
        [Rel<"rubrics_competency_id_fkey", "competency_id", "competencies">]
      >;
      questions: TableOf<
        QuestionRow,
        | "passage_id"
        | "stem_media_path"
        | "marks"
        | "difficulty"
        | "grade_sort_min"
        | "grade_sort_max"
        | "status"
        | "version"
        | "created_by",
        [
          Rel<"questions_bank_id_fkey", "bank_id", "question_banks">,
          Rel<"questions_competency_id_fkey", "competency_id", "competencies">,
          Rel<"questions_passage_id_fkey", "passage_id", "passages">,
          Rel<"questions_created_by_fkey", "created_by", "staff_profiles">,
        ]
      >;
      question_options: TableOf<
        QuestionOptionRow,
        "media_path" | "side",
        [Rel<"question_options_question_id_fkey", "question_id", "questions">]
      >;
      question_answers: TableOf<
        QuestionAnswerRow,
        "answer" | "partial_credit" | "rubric_id" | "updated_at",
        [
          Rel<"question_answers_question_id_fkey", "question_id", "questions", true>,
          Rel<"question_answers_rubric_id_fkey", "rubric_id", "rubrics">,
        ]
      >;
      assessment_templates: TableOf<
        AssessmentTemplateRow,
        "description" | "campus_id" | "status" | "version" | "created_by",
        [
          Rel<"assessment_templates_campus_id_fkey", "campus_id", "campuses">,
          Rel<"assessment_templates_created_by_fkey", "created_by", "staff_profiles">,
        ]
      >;
      template_sections: TableOf<
        TemplateSectionRow,
        | "instructions"
        | "time_limit_minutes"
        | "selection"
        | "random_count"
        | "random_difficulty_mix"
        | "practice_question_id",
        [
          Rel<"template_sections_template_id_fkey", "template_id", "assessment_templates">,
          Rel<"template_sections_subject_id_fkey", "subject_id", "subjects">,
          Rel<"template_sections_practice_question_id_fkey", "practice_question_id", "questions">,
        ]
      >;
      template_section_questions: TableOf<
        TemplateSectionQuestionRow,
        never,
        [
          Rel<"template_section_questions_section_id_fkey", "section_id", "template_sections">,
          Rel<"template_section_questions_question_id_fkey", "question_id", "questions">,
        ]
      >;
      benchmarks: TableOf<
        BenchmarkRow,
        "grade_sort_min" | "grade_sort_max" | "scope_id" | "description" | "is_active"
      >;
      assessment_forms: TableOf<
        AssessmentFormRow,
        never,
        [
          Rel<"assessment_forms_application_id_fkey", "application_id", "applications">,
          Rel<"assessment_forms_template_id_fkey", "template_id", "assessment_templates">,
        ]
      >;
      form_questions: TableOf<
        FormQuestionRow,
        | "section_instructions"
        | "section_time_limit_seconds"
        | "is_practice"
        | "question_id"
        | "stem_media_path"
        | "passage_snapshot"
        | "options"
        | "rubric_snapshot",
        [
          Rel<"form_questions_form_id_fkey", "form_id", "assessment_forms">,
          Rel<"form_questions_question_id_fkey", "question_id", "questions">,
          Rel<"form_questions_competency_id_fkey", "competency_id", "competencies">,
        ]
      >;
      form_answer_keys: TableOf<
        FormAnswerKeyRow,
        "answer" | "partial_credit",
        [Rel<"form_answer_keys_form_question_id_fkey", "form_question_id", "form_questions", true>]
      >;
      attempts: TableOf<
        AttemptRow,
        | "status"
        | "marking_status"
        | "launched_by"
        | "launched_at"
        | "started_at"
        | "submitted_at"
        | "auto_submitted"
        | "time_multiplier"
        | "accommodation_note"
        | "expires_at"
        | "device_user_agent",
        [
          Rel<"attempts_application_id_fkey", "application_id", "applications">,
          Rel<"attempts_booking_id_fkey", "booking_id", "bookings">,
          Rel<"attempts_form_id_fkey", "form_id", "assessment_forms">,
          Rel<"attempts_launched_by_fkey", "launched_by", "staff_profiles">,
        ]
      >;
      kiosk_codes: TableOf<
        KioskCodeRow,
        "used_at",
        [Rel<"kiosk_codes_attempt_id_fkey", "attempt_id", "attempts">]
      >;
      attempt_responses: TableOf<
        AttemptResponseRow,
        | "answered_at"
        | "is_correct"
        | "marks_awarded"
        | "marking_method"
        | "marked_by"
        | "marked_at"
        | "ai_suggestion",
        [
          Rel<"attempt_responses_attempt_id_fkey", "attempt_id", "attempts">,
          Rel<"attempt_responses_form_question_id_fkey", "form_question_id", "form_questions">,
          Rel<"attempt_responses_marked_by_fkey", "marked_by", "staff_profiles">,
        ]
      >;
      attempt_scores: TableOf<
        AttemptScoreRow,
        "scope_id" | "computed_at",
        [Rel<"attempt_scores_attempt_id_fkey", "attempt_id", "attempts">]
      >;
      admission_rulesets: TableOf<
        AdmissionRulesetRow,
        | "description"
        | "grade_sort_min"
        | "grade_sort_max"
        | "campus_id"
        | "version"
        | "status"
        | "activated_at"
        | "activated_by"
        | "created_by",
        [
          Rel<"admission_rulesets_campus_id_fkey", "campus_id", "campuses">,
          Rel<"admission_rulesets_activated_by_fkey", "activated_by", "staff_profiles">,
          Rel<"admission_rulesets_created_by_fkey", "created_by", "staff_profiles">,
        ]
      >;
      admission_rules: TableOf<
        AdmissionRuleRow,
        "scope_id" | "position",
        [Rel<"admission_rules_ruleset_id_fkey", "ruleset_id", "admission_rulesets">]
      >;
      admission_decisions: TableOf<
        AdmissionDecisionRow,
        "attempt_id" | "ruleset_id" | "ruleset_version" | "staff_id" | "override_reason" | "decided_at",
        [
          Rel<"admission_decisions_application_id_fkey", "application_id", "applications">,
          Rel<"admission_decisions_attempt_id_fkey", "attempt_id", "attempts">,
          Rel<"admission_decisions_ruleset_id_fkey", "ruleset_id", "admission_rulesets">,
          Rel<"admission_decisions_staff_id_fkey", "staff_id", "staff_profiles">,
        ]
      >;
      learning_profiles: TableOf<
        LearningProfileRow,
        "ai_model" | "prompt_version" | "validation_status" | "validation_errors" | "published_at",
        [
          Rel<"learning_profiles_attempt_id_fkey", "attempt_id", "attempts", true>,
          Rel<"learning_profiles_application_id_fkey", "application_id", "applications">,
        ]
      >;
      fee_schedules: TableOf<
        FeeScheduleRow,
        "grade_sort_min" | "grade_sort_max" | "status",
        [
          Rel<"fee_schedules_campus_id_fkey", "campus_id", "campuses">,
          Rel<"fee_schedules_academic_year_id_fkey", "academic_year_id", "academic_years">,
        ]
      >;
      fee_lines: TableOf<
        FeeLineRow,
        "payable_at_acceptance" | "position",
        [Rel<"fee_lines_schedule_id_fkey", "schedule_id", "fee_schedules">]
      >;
      offer_templates: TableOf<
        OfferTemplateRow,
        "version" | "description" | "allowed_variables" | "is_active" | "created_by",
        [Rel<"offer_templates_created_by_fkey", "created_by", "staff_profiles">]
      >;
      offers: TableOf<
        OfferRow,
        | "fee_schedule_id"
        | "start_date"
        | "expires_at"
        | "status"
        | "approved_by"
        | "approved_at"
        | "sent_at"
        | "first_viewed_at"
        | "conditions"
        | "withdrawn_reason",
        [
          Rel<"offers_application_id_fkey", "application_id", "applications">,
          Rel<"offers_template_id_fkey", "template_id", "offer_templates">,
          Rel<"offers_fee_schedule_id_fkey", "fee_schedule_id", "fee_schedules">,
          Rel<"offers_approved_by_fkey", "approved_by", "staff_profiles">,
        ]
      >;
      offer_acceptances: TableOf<
        OfferAcceptanceRow,
        "terms_accepted" | "fees" | "decline_reason" | "ip_hash" | "user_agent" | "decided_at",
        [
          Rel<"offer_acceptances_application_id_fkey", "application_id", "applications">,
          Rel<"offer_acceptances_offer_id_fkey", "offer_id", "offers", true>,
          Rel<"offer_acceptances_template_id_fkey", "template_id", "offer_templates">,
        ]
      >;
      payment_requests: TableOf<
        PaymentRequestRow,
        "lines" | "paid_minor" | "status" | "paid_at",
        [
          Rel<"payment_requests_application_id_fkey", "application_id", "applications">,
          Rel<"payment_requests_offer_id_fkey", "offer_id", "offers">,
          Rel<"payment_requests_acceptance_id_fkey", "acceptance_id", "offer_acceptances">,
        ]
      >;
      payments: TableOf<
        PaymentRow,
        | "provider_ref"
        | "status"
        | "approval_code"
        | "expires_at"
        | "verify_attempts"
        | "last_verified_at"
        | "raw_response"
        | "failure_reason"
        | "bank_reference"
        | "received_on"
        | "recorded_by"
        | "note"
        | "refunded_at"
        | "refunded_by"
        | "refund_note",
        [
          Rel<"payments_payment_request_id_fkey", "payment_request_id", "payment_requests">,
          Rel<"payments_application_id_fkey", "application_id", "applications">,
          Rel<"payments_recorded_by_fkey", "recorded_by", "staff_profiles">,
          Rel<"payments_refunded_by_fkey", "refunded_by", "staff_profiles">,
        ]
      >;
      bank_instructions: TableOf<
        BankInstructionRow,
        "campus_id" | "is_active",
        [Rel<"bank_instructions_campus_id_fkey", "campus_id", "campuses">]
      >;
      funnel_events: TableOf<
        FunnelEventRow,
        "application_id" | "campus_id" | "grade_id" | "elapsed_ms" | "occurred_at",
        [
          Rel<"funnel_events_application_id_fkey", "application_id", "applications">,
          Rel<"funnel_events_campus_id_fkey", "campus_id", "campuses">,
          Rel<"funnel_events_grade_id_fkey", "grade_id", "grades">,
        ]
      >;
    };
    Views: {
      /** The active campuses the caller may see; every campus filter reads this. */
      v_accessible_campuses: {
        Row: CampusRow;
        Relationships: [];
      };
      v_pipeline_counts: {
        Row: {
          campus_id: string;
          campus_name: string;
          status: ApplicationStatus;
          applications: number;
        };
        Relationships: [];
      };
      v_application_milestones: {
        Row: {
          application_id: string;
          campus_id: string;
          grade_id: string;
          intake_id: string;
          entry_route: EntryRoute;
          source: ApplicationSource;
          requires_assessment: boolean;
          status: ApplicationStatus;
          enquired_at: string;
          booked_at: string | null;
          attended_at: string | null;
          no_show_at: string | null;
          assessed_at: string | null;
          decided_at: string | null;
          offered_at: string | null;
          accepted_at: string | null;
          paid_at: string | null;
          enrolled_at: string | null;
        };
        Relationships: [];
      };
      v_funnel_effort: {
        Row: {
          sessions_started: number;
          enquiries_submitted: number;
          bookings_confirmed: number;
          median_seconds_to_enquiry: number | null;
          median_seconds_to_booking: number | null;
          p90_seconds_to_booking: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      current_staff_id: { Args: Record<string, never>; Returns: string | null };
      has_permission: { Args: { p_code: string }; Returns: boolean };
      my_permissions: { Args: Record<string, never>; Returns: string[] };
      can_access_campus: { Args: { p_campus_id: string }; Returns: boolean };
      next_application_reference: { Args: Record<string, never>; Returns: string };
      consume_token: {
        Args: { p_token_hash: string; p_ip_hash: string | null; p_user_agent: string | null };
        Returns: {
          outcome: "ok" | "expired" | "revoked" | "exhausted" | "unknown";
          application_id: string | null;
          purpose: TokenPurpose | null;
          token_id: string | null;
        }[];
      };
      consume_rate_limit: {
        Args: {
          p_bucket: string;
          p_subject: string;
          p_limit: number;
          p_window_seconds: number;
          p_cost?: number;
        };
        Returns: Json;
      };
      prune_rate_limits: { Args: Record<string, never>; Returns: number };
      session_places_taken: { Args: { p_session_id: string }; Returns: number };
      book_session: {
        Args: { p_application_id: string; p_session_id: string };
        Returns: string;
      };
      claim_jobs: { Args: { p_worker: string; p_limit?: number }; Returns: JobRow[] };
      commit_transition: {
        Args: {
          p_application_id: string;
          p_expected_status: string | null;
          p_new_status: string | null;
          p_next_action: string | null;
          p_next_action_due_at: string | null;
          p_event: Json;
          p_tasks?: Json;
          p_resolve_task_types?: string[];
          p_jobs?: Json;
          p_audit?: Json | null;
        };
        Returns: number;
      };
      dashboard_counts: { Args: Record<string, never>; Returns: Json };
      launch_attempt: {
        Args: {
          p_application_id: string;
          p_booking_id: string;
          p_template_id: string;
          p_time_multiplier: number;
          p_launched_by: string | null;
          p_accommodation_note?: string | null;
        };
        Returns: string;
      };
      start_attempt: { Args: { p_attempt_id: string; p_user_agent?: string | null }; Returns: AttemptRow };
      record_response: {
        Args: { p_attempt_id: string; p_form_question_id: string; p_response: Json; p_grace_seconds?: number };
        Returns: undefined;
      };
      submit_attempt: { Args: { p_attempt_id: string; p_auto?: boolean }; Returns: AttemptRow };
      activate_ruleset: { Args: { p_ruleset_id: string }; Returns: undefined };
      publish_offer_template: {
        Args: { p_key: string; p_name: string; p_description: string | null; p_body_html: string; p_terms_html: string };
        Returns: string;
      };
      publish_email_template: {
        Args: {
          p_key: string;
          p_name: string;
          p_description: string | null;
          p_subject: string;
          p_body_html: string;
          p_body_text: string;
        };
        Returns: string;
      };
      create_application: {
        Args: {
          p_parent_first_name: string;
          p_parent_last_name: string;
          p_email: string;
          p_email_normalised: string;
          p_mobile: string | null;
          p_mobile_normalised: string | null;
          p_child_first_name: string;
          p_child_last_name: string;
          p_child_date_of_birth: string;
          p_campus_id: string;
          p_grade_id: string;
          p_recommended_grade_id: string | null;
          p_intake_id: string;
          p_entry_route: EntryRoute;
          p_source?: ApplicationSource;
          p_current_school?: string | null;
          p_current_grade?: string | null;
        };
        Returns: {
          application_id: string;
          reference: string;
          contact_id: string;
          created: boolean;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
