import "server-only";
import type { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { HrError } from "@/lib/errors";
import { cleanBehaviour } from "@/lib/integrity/signals";
import { wordCount } from "@/lib/questions/rubric";
import { getHrSettings } from "@/lib/settings";
import type { ApplicantSession } from "@/lib/tokens/session";
import { loadDraftFor } from "@/lib/applicant/scope";
import type {
  AnswerSchema,
  ComplianceSchema,
  EmploymentListSchema,
  PersonalSchema,
  QualificationsSchema,
  RefereeSchema,
  Section,
} from "@/lib/applicant/schemas";

/**
 * Saving one section of an applicant's own draft. Each function takes the
 * verified session, re-reads the draft by the id in it, and refuses if the
 * application has been sent or the vacancy has closed. Lists (qualifications,
 * jobs, referees) are replaced whole: the form always posts the full list.
 */

async function openDraft(admin: AdminClient, session: ApplicantSession) {
  const draft = await loadDraftFor(admin, session);
  if (!draft.ok) {
    if (draft.reason === "submitted") throw new HrError("Your application has already been sent, so it cannot be changed.");
    if (draft.reason === "closed") throw new HrError("This vacancy has closed, so the application cannot be changed.");
    throw new HrError("We could not find your application. Use the link in your email to open it again.");
  }
  return draft;
}

async function markSection(admin: AdminClient, applicationId: string, current: string[], section: Section, done: boolean): Promise<void> {
  const next = new Set(current);
  if (done) next.add(section);
  else next.delete(section);
  const { error } = await admin
    .from("hr_applications")
    .update({ sections_completed: [...next], last_saved_at: new Date().toISOString() })
    .eq("id", applicationId);
  if (error) throw new Error(error.message);
}

export async function savePersonal(admin: AdminClient, session: ApplicantSession, input: z.infer<typeof PersonalSchema>): Promise<void> {
  const { application } = await openDraft(admin, session);
  const { error } = await admin
    .from("hr_applications")
    .update({
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      nationality: input.nationality,
      is_citizen: input.is_citizen === "yes",
    })
    .eq("id", application.id);
  if (error) throw new Error(error.message);
  await markSection(admin, application.id, application.sections_completed, "personal", true);
}

export async function saveQualifications(admin: AdminClient, session: ApplicantSession, input: z.infer<typeof QualificationsSchema>): Promise<void> {
  const { application } = await openDraft(admin, session);
  const { error: delError } = await admin.from("hr_application_qualifications").delete().eq("application_id", application.id);
  if (delError) throw new Error(delError.message);
  const { error } = await admin.from("hr_application_qualifications").insert(
    input.map((q, i) => ({ application_id: application.id, ...q, sort_order: i }))
  );
  if (error) throw new Error(error.message);
  await markSection(admin, application.id, application.sections_completed, "qualifications", input.length > 0);
}

export async function saveEmployment(admin: AdminClient, session: ApplicantSession, input: z.infer<typeof EmploymentListSchema>): Promise<void> {
  const { application } = await openDraft(admin, session);
  const current = input.filter((j) => !j.end_on).length;
  if (current > 2) throw new HrError("Only mark the jobs you still do as current.");
  const { error: delError } = await admin.from("hr_application_employment").delete().eq("application_id", application.id);
  if (delError) throw new Error(delError.message);
  if (input.length) {
    const { error } = await admin.from("hr_application_employment").insert(
      input.map((j, i) => ({ application_id: application.id, ...j, sort_order: i }))
    );
    if (error) throw new Error(error.message);
  }
  // A newly qualified teacher may have no jobs to list; the section is still done.
  await markSection(admin, application.id, application.sections_completed, "career", true);
}

export async function saveCompliance(admin: AdminClient, session: ApplicantSession, input: z.infer<typeof ComplianceSchema>): Promise<void> {
  const { application } = await openDraft(admin, session);
  const yes = (v: "yes" | "no") => v === "yes";
  const { error } = await admin.from("hr_application_compliance").upsert(
    {
      application_id: application.id,
      registration_body: input.registration_body,
      registration_number: input.registration_number,
      registration_expires_on: input.registration_expires_on,
      needs_permit: yes(input.needs_permit),
      permit_type: input.permit_type,
      permit_number: input.permit_number,
      permit_expires_on: input.permit_expires_on,
      police_clearance: input.police_clearance,
      police_clearance_issued_on: input.police_clearance_issued_on,
      child_protection_clear: yes(input.child_protection_clear),
      criminal_record: yes(input.criminal_record),
      criminal_record_detail: input.criminal_record_detail,
      dismissed_before: yes(input.dismissed_before),
      dismissed_detail: input.dismissed_detail,
      safeguarding_concern: yes(input.safeguarding_concern),
      safeguarding_detail: input.safeguarding_detail,
      declaration_name: input.declaration_name,
      declared_at: new Date().toISOString(),
    },
    { onConflict: "application_id" }
  );
  if (error) throw new Error(error.message);
  await markSection(admin, application.id, application.sections_completed, "compliance", true);
}

/**
 * One answer, autosaved as the applicant types. The writing behaviour the
 * browser recorded is merged with what was stored, taking the larger of each
 * counter, so a page reload cannot reset "characters pasted" to zero.
 */
export async function saveAnswer(admin: AdminClient, session: ApplicantSession, input: z.infer<typeof AnswerSchema>): Promise<void> {
  const { application } = await openDraft(admin, session);
  const { data: question, error: qError } = await admin
    .from("hr_vacancy_questions")
    .select("id, word_limit")
    .eq("id", input.question_id)
    .eq("vacancy_id", application.vacancy_id)
    .eq("status", "approved")
    .maybeSingle();
  if (qError) throw new Error(qError.message);
  if (!question) throw new HrError("That question is not part of this application.");
  const words = wordCount(input.text);
  if (words > question.word_limit * 1.2) throw new HrError(`Please keep this answer under ${question.word_limit} words.`);

  const { data: existing } = await admin
    .from("hr_application_answers")
    .select("integrity")
    .eq("application_id", application.id)
    .eq("vacancy_question_id", question.id)
    .maybeSingle();
  const before = cleanBehaviour(existing?.integrity);
  const now = cleanBehaviour(input.behaviour);
  const merged = {
    activeMs: Math.max(before.activeMs, now.activeMs),
    keystrokes: Math.max(before.keystrokes, now.keystrokes),
    pastedChars: Math.max(before.pastedChars, now.pastedChars),
    pasteEvents: Math.max(before.pasteEvents, now.pasteEvents),
    blurCount: Math.max(before.blurCount, now.blurCount),
  };

  const { error } = await admin.from("hr_application_answers").upsert(
    {
      application_id: application.id,
      vacancy_question_id: question.id,
      answer_text: input.text,
      word_count: words,
      integrity: merged as unknown as Json,
    },
    { onConflict: "application_id,vacancy_question_id" }
  );
  if (error) throw new Error(error.message);
  await admin.from("hr_applications").update({ last_saved_at: new Date().toISOString() }).eq("id", application.id);
}

export async function acceptIntegrityNotice(admin: AdminClient, session: ApplicantSession): Promise<void> {
  const { application } = await openDraft(admin, session);
  if (application.integrity_notice_accepted_at) return;
  const { error } = await admin
    .from("hr_applications")
    .update({ integrity_notice_accepted_at: new Date().toISOString() })
    .eq("id", application.id);
  if (error) throw new Error(error.message);
}

export async function markQuestionsDone(admin: AdminClient, session: ApplicantSession): Promise<void> {
  const { application } = await openDraft(admin, session);
  const [{ data: questions }, { data: answers }] = await Promise.all([
    admin.from("hr_vacancy_questions").select("id").eq("vacancy_id", application.vacancy_id).eq("status", "approved"),
    admin.from("hr_application_answers").select("vacancy_question_id, answer_text").eq("application_id", application.id),
  ]);
  const answered = new Set((answers ?? []).filter((a) => a.answer_text.trim().length > 0).map((a) => a.vacancy_question_id));
  const missing = (questions ?? []).filter((q) => !answered.has(q.id)).length;
  if (missing) throw new HrError(`Please answer every question. ${missing} still need${missing === 1 ? "s" : ""} an answer.`);
  if (!application.integrity_notice_accepted_at) throw new HrError("Please confirm that you wrote the answers yourself.");
  await markSection(admin, application.id, application.sections_completed, "questions", true);
}

export async function saveReferees(admin: AdminClient, session: ApplicantSession, input: z.infer<typeof RefereeSchema>[]): Promise<void> {
  const { application } = await openDraft(admin, session);
  const settings = await getHrSettings(admin);
  if (input.length < settings.minReferees) throw new HrError(`Please give at least ${settings.minReferees} referees.`);
  if (input.length > settings.maxReferees) throw new HrError(`Please give no more than ${settings.maxReferees} referees.`);
  if (!input.some((r) => r.is_most_recent_employer)) {
    throw new HrError("One referee must be from your most recent employer, such as your principal or line manager.");
  }
  const emails = input.map((r) => r.email);
  if (new Set(emails).size !== emails.length) throw new HrError("Each referee needs a different email address.");
  if (emails.includes(application.email_normalised)) throw new HrError("A referee cannot be you. Please give someone else's email address.");

  const { error: delError } = await admin.from("hr_referees").delete().eq("application_id", application.id);
  if (delError) throw new Error(delError.message);
  const { error } = await admin.from("hr_referees").insert(input.map((r, i) => ({ application_id: application.id, ...r, sort_order: i })));
  if (error) throw new Error(error.message);
  await markSection(admin, application.id, application.sections_completed, "references", true);
}

export async function markDocumentsDone(admin: AdminClient, session: ApplicantSession): Promise<void> {
  const { application } = await openDraft(admin, session);
  const { count } = await admin
    .from("hr_application_documents")
    .select("id", { count: "exact", head: true })
    .eq("application_id", application.id)
    .eq("kind", "cv");
  if (!count) throw new HrError("Please upload your CV.");
  await markSection(admin, application.id, application.sections_completed, "documents", true);
}
