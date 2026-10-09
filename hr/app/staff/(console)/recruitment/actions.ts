"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { staffActor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { moveStage, sendOffer } from "@/lib/recruitment/engine";
import { hireApplicant } from "@/lib/employees/hire";
import {
  addNote,
  InterviewSchema,
  rescheduleInterview,
  scheduleInterview,
  setCommunicationBand,
  setHumanBand,
  setInterviewStatus,
} from "@/lib/recruitment/staff-ops";
import {
  createVacancy,
  deleteQuestion,
  draftQuestionsWithAi,
  moveQuestion,
  publishVacancy,
  QuestionEditSchema,
  saveQuestion,
  setQuestionApproval,
  setVacancyStatus,
  updateVacancy,
  VacancySchema,
} from "@/lib/recruitment/vacancies";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction, type StaffContext } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every recruitment action a member of staff takes. Each one checks the
 * permission, reads the row it is about through the person's own client (so
 * a campus restriction answers "not found" rather than allowing a write), and
 * only then writes under the service role, with an audit row.
 */

const id = z.string().uuid();

async function vacancyFor(ctx: StaffContext, vacancyId: string) {
  const { data } = await ctx.supabase.from("hr_vacancies").select("id, campus_id, status").eq("id", id.parse(vacancyId)).maybeSingle();
  if (!data) throw new HrError("Vacancy not found.");
  return data;
}

async function applicationFor(ctx: StaffContext, applicationId: string) {
  const { data } = await ctx.supabase.from("hr_applications").select("*").eq("id", id.parse(applicationId)).maybeSingle();
  if (!data) throw new HrError("Application not found.");
  return data;
}

async function campusAllowed(ctx: StaffContext, campusId: string) {
  const { data } = await ctx.supabase.rpc("can_access_campus", { p_campus_id: campusId });
  if (!data) throw new HrError("You do not have access to that school.");
}

function vacancyInput(formData: FormData) {
  return VacancySchema.parse({
    ...Object.fromEntries(formData),
    requirements: String(formData.get("requirements") ?? "")
      .split("\n")
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean),
  });
}

// ---------------------------------------------------------------------------
// Vacancies
// ---------------------------------------------------------------------------

export async function createVacancyAction(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let created: string | null = null;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const input = vacancyInput(formData);
    await campusAllowed(ctx, input.campus_id);
    created = await createVacancy(createAdminClient(), staffActor(ctx), input);
  });
  if (created) redirect(`/staff/recruitment/vacancies/${created}/questions`);
  return state;
}

export async function updateVacancyAction(vacancyId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    await vacancyFor(ctx, vacancyId);
    const input = vacancyInput(formData);
    await campusAllowed(ctx, input.campus_id);
    await updateVacancy(createAdminClient(), staffActor(ctx), vacancyId, input);
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}`);
  });
}

export async function publishVacancyAction(vacancyId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    await vacancyFor(ctx, vacancyId);
    await publishVacancy(createAdminClient(), staffActor(ctx), vacancyId);
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}`);
  });
}

export async function setVacancyStatusAction(vacancyId: string, to: "closed" | "archived" | "published"): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    await vacancyFor(ctx, vacancyId);
    await setVacancyStatus(createAdminClient(), staffActor(ctx), vacancyId, to);
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}`);
  });
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function draftQuestionsAction(vacancyId: string): Promise<StaffActionState & { note?: string | null }> {
  let note: string | null = null;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("hr.questions.write");
    await vacancyFor(ctx, vacancyId);
    const admin = createAdminClient();
    const verdict = await enforceRateLimit(admin, LIMITS.aiDraft, `staff:${ctx.userId}`);
    if (!verdict.ok) throw new HrError("You have asked for many drafts in the last hour. Try again later.");
    const result = await draftQuestionsWithAi(admin, staffActor(ctx), vacancyId);
    note = result.note;
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}/questions`);
  });
  return { ...state, note };
}

export async function saveQuestionAction(vacancyId: string, questionId: string | null, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.questions.write");
    await vacancyFor(ctx, vacancyId);
    const bands = [0, 1, 2, 3, 4].map((band) => ({ band, descriptor: String(formData.get(`band_${band}`) ?? "").trim() }));
    const input = QuestionEditSchema.parse({
      prompt: formData.get("prompt"),
      competency: formData.get("competency"),
      word_limit: formData.get("word_limit"),
      rubric: { bands },
    });
    await saveQuestion(createAdminClient(), staffActor(ctx), vacancyId, questionId ? id.parse(questionId) : null, input);
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}/questions`);
  });
}

export async function approveQuestionsAction(vacancyId: string, questionIds: string[], approve: boolean): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.questions.write");
    await vacancyFor(ctx, vacancyId);
    await setQuestionApproval(createAdminClient(), staffActor(ctx), vacancyId, questionIds.map((q) => id.parse(q)), approve);
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}/questions`);
  });
}

export async function deleteQuestionAction(vacancyId: string, questionId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.questions.write");
    await vacancyFor(ctx, vacancyId);
    await deleteQuestion(createAdminClient(), staffActor(ctx), vacancyId, id.parse(questionId));
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}/questions`);
  });
}

export async function moveQuestionAction(vacancyId: string, questionId: string, direction: "up" | "down"): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.questions.write");
    await vacancyFor(ctx, vacancyId);
    await moveQuestion(createAdminClient(), vacancyId, id.parse(questionId), direction);
    revalidatePath(`/staff/recruitment/vacancies/${vacancyId}/questions`);
  });
}

// ---------------------------------------------------------------------------
// The pipeline and an application
// ---------------------------------------------------------------------------

const Stage = z.enum(["review", "shortlisted", "unsuccessful"]);

export async function moveStageAction(applicationId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const app = await applicationFor(ctx, applicationId);
    const to = Stage.parse(formData.get("to"));
    const expected = Stage.nullable().parse(formData.get("expected") || null);
    await moveStage(createAdminClient(), staffActor(ctx), {
      applicationId: app.id,
      expected,
      to,
      reason: String(formData.get("reason") ?? "").trim().slice(0, 500) || null,
      notify: formData.get("notify") === "on",
    });
    drainSoon();
    revalidatePath("/staff/recruitment/pipeline");
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

export async function addNoteAction(applicationId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const app = await applicationFor(ctx, applicationId);
    await addNote(createAdminClient(), staffActor(ctx), app.id, String(formData.get("body") ?? ""));
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

const Band = z.union([z.literal(""), z.coerce.number().int().min(0).max(4)]);

export async function markAnswerAction(applicationId: string, answerId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const app = await applicationFor(ctx, applicationId);
    const band = Band.parse(formData.get("band") ?? "");
    await setHumanBand(createAdminClient(), staffActor(ctx), {
      applicationId: app.id,
      answerId: id.parse(answerId),
      band: band === "" ? null : band,
      note: String(formData.get("note") ?? "").trim().slice(0, 1000) || null,
    });
    drainSoon();
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

export async function markCommunicationAction(applicationId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const app = await applicationFor(ctx, applicationId);
    const band = Band.parse(formData.get("band") ?? "");
    await setCommunicationBand(createAdminClient(), staffActor(ctx), app.id, band === "" ? null : band);
    drainSoon();
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

export async function scheduleInterviewAction(applicationId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const app = await applicationFor(ctx, applicationId);
    await scheduleInterview(createAdminClient(), staffActor(ctx), app.id, app.campus_id, InterviewSchema.parse(Object.fromEntries(formData)));
    drainSoon();
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

export async function rescheduleInterviewAction(applicationId: string, interviewId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const app = await applicationFor(ctx, applicationId);
    await rescheduleInterview(createAdminClient(), staffActor(ctx), id.parse(interviewId), InterviewSchema.parse(Object.fromEntries(formData)));
    drainSoon();
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

export async function closeInterviewAction(applicationId: string, interviewId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.write");
    const app = await applicationFor(ctx, applicationId);
    const to = z.enum(["completed", "cancelled"]).parse(formData.get("to"));
    await setInterviewStatus(createAdminClient(), staffActor(ctx), id.parse(interviewId), to, String(formData.get("notes") ?? "").trim() || null);
    drainSoon();
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

export async function sendOfferAction(applicationId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.hire");
    const app = await applicationFor(ctx, applicationId);
    await sendOffer(createAdminClient(), staffActor(ctx), app.id, String(formData.get("note") ?? "").trim().slice(0, 1000) || null);
    drainSoon();
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
}

export async function hireAction(applicationId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let employeeId: string | null = null;
  let toEmployee = false;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("hr.recruitment.hire");
    toEmployee = can(ctx.permissions, "hr.employees.read");
    const app = await applicationFor(ctx, applicationId);
    const startDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date.").parse(formData.get("start_date"));
    employeeId = await hireApplicant(createAdminClient(), staffActor(ctx), app, { startDate });
    revalidatePath(`/staff/recruitment/applications/${app.id}`);
  });
  if (employeeId && state.ok) redirect(toEmployee ? `/staff/employees/${employeeId}` : `/staff/recruitment/applications/${applicationId}?hired=1`);
  return state;
}
