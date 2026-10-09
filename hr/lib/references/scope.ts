import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RefereeSession } from "@/lib/tokens/session";

/**
 * What a referee's page may read: the one request their cookie names, the
 * applicant's name and the post, and the role and dates the applicant gave
 * for that employer, so the referee can confirm them. Nothing else about the
 * application.
 */
export async function loadRefereeView(session: RefereeSession) {
  const admin = createAdminClient();
  const { data: request } = await admin.from("hr_reference_requests").select("id, status, referee_id, application_id, expires_at").eq("id", session.referenceRequestId).maybeSingle();
  if (!request) return null;
  const [{ data: referee }, { data: app }] = await Promise.all([
    admin.from("hr_referees").select("full_name, organisation, relationship").eq("id", request.referee_id).single(),
    admin.from("hr_applications").select("first_name, last_name, vacancy_id, status").eq("id", request.application_id).single(),
  ]);
  if (!referee || !app) return null;
  const [{ data: vacancy }, { data: jobs }] = await Promise.all([
    admin.from("hr_vacancies").select("title").eq("id", app.vacancy_id).single(),
    admin.from("hr_application_employment").select("employer, role_title, start_on, end_on").eq("application_id", request.application_id),
  ]);
  const org = referee.organisation.trim().toLowerCase();
  const job = (jobs ?? []).find((j) => j.employer.trim().toLowerCase() === org) ?? null;
  return {
    status: request.status,
    open: ["pending", "sent", "opened"].includes(request.status) && app.status === "submitted",
    refereeName: referee.full_name,
    relationship: referee.relationship,
    applicantName: `${app.first_name} ${app.last_name}`.trim(),
    vacancyTitle: vacancy?.title ?? "",
    statedJob: job,
  };
}
