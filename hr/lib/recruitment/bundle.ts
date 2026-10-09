import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CampusRow,
  Database,
  HrApplicationAnswerRow,
  HrApplicationComplianceRow,
  HrApplicationDocumentRow,
  HrApplicationEmploymentRow,
  HrApplicationQualificationRow,
  HrApplicationRow,
  HrInterviewRow,
  HrRefereeRow,
  HrReferenceRequestRow,
  HrReferenceResponseRow,
  HrVacancyQuestionRow,
  HrVacancyRow,
} from "@/lib/supabase/types";

/**
 * Everything about one application, in one read. Used by the scoring job,
 * the marking and integrity jobs (under the service role) and by the staff
 * applicant page (through the staff member's own client, so RLS decides what
 * comes back: without the compliance permission, `compliance` is null).
 */
export type ApplicationBundle = {
  application: HrApplicationRow;
  vacancy: HrVacancyRow;
  campus: CampusRow;
  qualifications: HrApplicationQualificationRow[];
  employment: HrApplicationEmploymentRow[];
  compliance: HrApplicationComplianceRow | null;
  documents: HrApplicationDocumentRow[];
  questions: HrVacancyQuestionRow[];
  answers: HrApplicationAnswerRow[];
  referees: HrRefereeRow[];
  requests: HrReferenceRequestRow[];
  responses: HrReferenceResponseRow[];
  interviews: HrInterviewRow[];
};

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: not found`);
  return result.data;
}

export async function loadApplicationBundle(
  client: SupabaseClient<Database>,
  applicationId: string
): Promise<ApplicationBundle | null> {
  const { data: application, error } = await client.from("hr_applications").select("*").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!application) return null;

  const [vacancy, campus, qualifications, employment, compliance, documents, questions, answers, referees, requests, responses, interviews] =
    await Promise.all([
      client.from("hr_vacancies").select("*").eq("id", application.vacancy_id).single(),
      client.from("campuses").select("*").eq("id", application.campus_id).single(),
      client.from("hr_application_qualifications").select("*").eq("application_id", applicationId).order("sort_order"),
      client.from("hr_application_employment").select("*").eq("application_id", applicationId).order("start_on", { ascending: false }),
      client.from("hr_application_compliance").select("*").eq("application_id", applicationId).maybeSingle(),
      client.from("hr_application_documents").select("*").eq("application_id", applicationId).order("uploaded_at"),
      client.from("hr_vacancy_questions").select("*").eq("vacancy_id", application.vacancy_id).eq("status", "approved").order("sort_order"),
      client.from("hr_application_answers").select("*").eq("application_id", applicationId),
      client.from("hr_referees").select("*").eq("application_id", applicationId).order("sort_order"),
      client.from("hr_reference_requests").select("*").eq("application_id", applicationId),
      client.from("hr_reference_responses").select("*").eq("application_id", applicationId),
      client.from("hr_interviews").select("*").eq("application_id", applicationId).order("starts_at"),
    ]);

  return {
    application,
    vacancy: must(vacancy, "vacancy"),
    campus: must(campus, "campus"),
    qualifications: qualifications.data ?? [],
    employment: employment.data ?? [],
    compliance: compliance.data ?? null,
    documents: documents.data ?? [],
    questions: questions.data ?? [],
    answers: answers.data ?? [],
    referees: referees.data ?? [],
    requests: requests.data ?? [],
    responses: responses.data ?? [],
    interviews: interviews.data ?? [],
  };
}

export function fullName(a: Pick<HrApplicationRow, "first_name" | "last_name">): string {
  return `${a.first_name} ${a.last_name}`.trim();
}
