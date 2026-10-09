import "server-only";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type {
  HrApplicationComplianceRow,
  HrApplicationDocumentRow,
  HrApplicationEmploymentRow,
  HrApplicationQualificationRow,
  HrApplicationRow,
  HrRefereeRow,
  HrVacancyRow,
  CampusRow,
} from "@/lib/supabase/types";
import type { ApplicantSession } from "@/lib/tokens/session";

/**
 * The only way applicant pages read the database.
 *
 * Applicants are not database principals, so these reads run under the
 * service role with no RLS behind them. Every function here takes the
 * verified session and scopes by the id in it, never by an id from the
 * request. `scope.test.ts` fails the build if anything under `app/(applicant)`
 * queries a table itself.
 *
 * What comes back is what the applicant may see of their own application:
 * never a band, a rubric, an AI rationale, a likelihood, a score, a note or a
 * reference.
 */

export type ApplicantQuestion = { id: string; prompt: string; word_limit: number; sort_order: number };

export type ApplicantView = {
  application: Pick<
    HrApplicationRow,
    | "id"
    | "reference"
    | "first_name"
    | "last_name"
    | "email"
    | "phone"
    | "nationality"
    | "is_citizen"
    | "status"
    | "sections_completed"
    | "integrity_notice_accepted_at"
    | "submitted_at"
    | "talent_pool_consent"
  >;
  vacancy: Pick<HrVacancyRow, "id" | "title" | "slug" | "phase" | "subject" | "closes_on" | "status">;
  campus: Pick<CampusRow, "id" | "name" | "country">;
  qualifications: HrApplicationQualificationRow[];
  employment: HrApplicationEmploymentRow[];
  compliance: HrApplicationComplianceRow | null;
  documents: Pick<HrApplicationDocumentRow, "id" | "kind" | "file_name" | "size_bytes" | "uploaded_at">[];
  questions: ApplicantQuestion[];
  answers: { vacancy_question_id: string; answer_text: string }[];
  referees: HrRefereeRow[];
};

export async function loadApplicantView(session: ApplicantSession, admin: AdminClient = createAdminClient()): Promise<ApplicantView | null> {
  const id = session.applicationId;
  const { data: app, error } = await admin
    .from("hr_applications")
    .select(
      "id, reference, first_name, last_name, email, phone, nationality, is_citizen, status, sections_completed, integrity_notice_accepted_at, submitted_at, talent_pool_consent, vacancy_id, campus_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app || app.status === "anonymised") return null;

  const [vacancy, campus, qualifications, employment, compliance, documents, questions, answers, referees] = await Promise.all([
    admin.from("hr_vacancies").select("id, title, slug, phase, subject, closes_on, status").eq("id", app.vacancy_id).single(),
    admin.from("campuses").select("id, name, country").eq("id", app.campus_id).single(),
    admin.from("hr_application_qualifications").select("*").eq("application_id", id).order("sort_order"),
    admin.from("hr_application_employment").select("*").eq("application_id", id).order("sort_order"),
    admin.from("hr_application_compliance").select("*").eq("application_id", id).maybeSingle(),
    admin.from("hr_application_documents").select("id, kind, file_name, size_bytes, uploaded_at").eq("application_id", id).order("uploaded_at"),
    // Prompt and word limit only. No rubric: answers never leave the server.
    admin.from("hr_vacancy_questions").select("id, prompt, word_limit, sort_order").eq("vacancy_id", app.vacancy_id).eq("status", "approved").order("sort_order"),
    admin.from("hr_application_answers").select("vacancy_question_id, answer_text").eq("application_id", id),
    admin.from("hr_referees").select("*").eq("application_id", id).order("sort_order"),
  ]);
  if (!vacancy.data || !campus.data) return null;

  const { vacancy_id: _v, campus_id: _c, ...application } = app;
  void _v;
  void _c;
  return {
    application,
    vacancy: vacancy.data,
    campus: campus.data,
    qualifications: qualifications.data ?? [],
    employment: employment.data ?? [],
    compliance: compliance.data ?? null,
    documents: documents.data ?? [],
    questions: questions.data ?? [],
    answers: answers.data ?? [],
    referees: referees.data ?? [],
  };
}

/** The application row a write is about, checked to be an open draft. */
export async function loadDraftFor(admin: AdminClient, session: ApplicantSession): Promise<
  | { ok: true; application: HrApplicationRow; vacancy: HrVacancyRow }
  | { ok: false; reason: "missing" | "submitted" | "closed" }
> {
  const { data: application, error } = await admin.from("hr_applications").select("*").eq("id", session.applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!application || application.status === "anonymised") return { ok: false, reason: "missing" };
  if (application.status !== "draft") return { ok: false, reason: "submitted" };
  const { data: vacancy, error: vacancyError } = await admin.from("hr_vacancies").select("*").eq("id", application.vacancy_id).single();
  if (vacancyError || !vacancy) return { ok: false, reason: "missing" };
  if (!vacancyIsOpen(vacancy)) return { ok: false, reason: "closed" };
  return { ok: true, application, vacancy };
}

export function vacancyIsOpen(v: Pick<HrVacancyRow, "status" | "closes_on">, today = new Date()): boolean {
  if (v.status !== "published") return false;
  if (!v.closes_on) return true;
  return v.closes_on >= today.toISOString().slice(0, 10);
}
