"use server";

import { redirect } from "next/navigation";
import { ZodError, type ZodType } from "zod";
import {
  AnswerSchema,
  ComplianceSchema,
  EmploymentListSchema,
  PersonalSchema,
  QualificationsSchema,
  RefereeSchema,
} from "@/lib/applicant/schemas";
import {
  acceptIntegrityNotice,
  markDocumentsDone,
  removeOwnDocument,
  markQuestionsDone,
  saveAnswer,
  saveCompliance,
  saveEmployment,
  savePersonal,
  saveQualifications,
  saveReferees,
} from "@/lib/applicant/save";
import { HrError } from "@/lib/errors";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { requestFreshLink, submitApplication, withdrawApplication } from "@/lib/recruitment/engine";
import { drainSoon } from "@/lib/staff/action-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { endApplicantSession, readApplicantSession } from "@/lib/tokens/server";

/**
 * Every write an applicant makes. Each action reads the verified cookie,
 * never an id from the form, and hands the session to `lib/applicant/save`,
 * which re-reads the draft by the id in it.
 */

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean };

function fieldErrors(e: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

async function run(fn: (session: NonNullable<Awaited<ReturnType<typeof readApplicantSession>>>) => Promise<void>): Promise<FormState> {
  const session = await readApplicantSession();
  if (!session) return { error: "Your session has ended. Open the link in your email to continue." };
  const admin = createAdminClient();
  const verdict = await enforceRateLimit(admin, LIMITS.applySave, `app:${session.applicationId}`);
  if (!verdict.ok) return { error: "You are saving very quickly. Wait a moment and try again." };
  try {
    await fn(session);
    return { ok: true };
  } catch (e) {
    if (e instanceof ZodError) return { error: "Please check the highlighted answers.", fieldErrors: fieldErrors(e) };
    if (e instanceof HrError) return { error: e.message };
    console.error("[apply] save failed", e);
    return { error: "We could not save that. Check your connection and try again." };
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function json(formData: FormData, key: string): unknown {
  try {
    return JSON.parse(String(formData.get(key) ?? "null"));
  } catch {
    return null;
  }
}

export async function savePersonalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const state = await run((s) => savePersonal(createAdminClient(), s, parse(PersonalSchema, Object.fromEntries(formData))));
  if (state.ok) redirect("/apply?saved=personal");
  return state;
}

export async function saveQualificationsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const state = await run((s) => saveQualifications(createAdminClient(), s, parse(QualificationsSchema, json(formData, "rows"))));
  if (state.ok) redirect("/apply?saved=qualifications");
  return state;
}

export async function saveEmploymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const state = await run((s) => saveEmployment(createAdminClient(), s, parse(EmploymentListSchema, json(formData, "rows"))));
  if (state.ok) redirect("/apply?saved=career");
  return state;
}

export async function saveComplianceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const state = await run((s) => saveCompliance(createAdminClient(), s, parse(ComplianceSchema, Object.fromEntries(formData))));
  if (state.ok) redirect("/apply?saved=compliance");
  return state;
}

export async function saveRefereesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const rows = json(formData, "rows");
  const state = await run((s) => saveReferees(createAdminClient(), s, parse(RefereeSchema.array(), rows)));
  if (state.ok) redirect("/apply?saved=references");
  return state;
}

/** Autosave for one written answer. Returns rather than redirects: it runs while the applicant types. */
export async function saveAnswerAction(input: { question_id: string; text: string; behaviour: Record<string, number> }): Promise<FormState> {
  return run((s) => saveAnswer(createAdminClient(), s, parse(AnswerSchema, input)));
}

export async function acceptIntegrityNoticeAction(): Promise<FormState> {
  return run((s) => acceptIntegrityNotice(createAdminClient(), s));
}

export async function finishQuestionsAction(_prev: FormState): Promise<FormState> {
  const state = await run((s) => markQuestionsDone(createAdminClient(), s));
  if (state.ok) redirect("/apply?saved=questions");
  return state;
}

export async function finishDocumentsAction(_prev: FormState): Promise<FormState> {
  const state = await run((s) => markDocumentsDone(createAdminClient(), s));
  if (state.ok) redirect("/apply?saved=documents");
  return state;
}

export async function removeDocumentAction(documentId: string): Promise<FormState> {
  return run((s) => removeOwnDocument(createAdminClient(), s, documentId));
}

export async function submitAction(_prev: FormState): Promise<FormState> {
  const ctx = await requestContext();
  const state = await run((s) => submitApplication(createAdminClient(), s.applicationId, ctx.ipHash));
  if (state.ok) {
    drainSoon();
    redirect("/apply?sent=1");
  }
  return state;
}

export async function withdrawAction(_prev: FormState): Promise<FormState> {
  const state = await run((s) => withdrawApplication(createAdminClient(), s.applicationId));
  if (state.ok) {
    drainSoon();
    await endApplicantSession();
    redirect("/apply/link?withdrawn=1");
  }
  return state;
}

export async function freshLinkAction(_prev: FormState & { sent?: boolean }, formData: FormData): Promise<FormState & { sent?: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter the email address you applied with." };
  const admin = createAdminClient();
  const ctx = await requestContext();
  for (const [limit, subject] of [
    [LIMITS.freshLinkByIp, `ip:${ctx.ipHash ?? "unknown"}`],
    [LIMITS.freshLinkByEmail, `email:${email}`],
  ] as const) {
    const verdict = await enforceRateLimit(admin, limit, subject);
    if (!verdict.ok) return { error: "Too many requests. Please wait a few minutes and try again." };
  }
  await requestFreshLink(admin, email);
  drainSoon();
  // The same answer whether or not the address is known.
  return { sent: true };
}
