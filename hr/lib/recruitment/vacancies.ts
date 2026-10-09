import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json, Phase } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { draftVacancyQuestions, type BankQuestionForDraft } from "@/lib/ai/recruitment";
import { HrError } from "@/lib/errors";
import { parseRubric, RubricSchema } from "@/lib/questions/rubric";
import { getHrSettings } from "@/lib/settings";

/**
 * Vacancies and the questions each one asks. A vacancy is a draft until a
 * person publishes it; publishing freezes its questions (a trigger in the
 * database enforces that) and its scoring weights.
 */

export const VacancySchema = z.object({
  campus_id: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  phase: z.enum(["preschool", "primary", "secondary", "general"]),
  subject: z.string().trim().max(120).optional().transform((v) => v || null),
  grade_range: z.string().trim().max(120).optional().transform((v) => v || null),
  employment_type: z.enum(["permanent", "fixed_term", "part_time", "temporary"]),
  summary: z.string().trim().max(400),
  description: z.string().trim().max(8000),
  requirements: z.array(z.string().trim().min(1).max(300)).max(20),
  salary_note: z.string().trim().max(200).optional().transform((v) => v || null),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
  closes_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
});

export type VacancyInput = z.infer<typeof VacancySchema>;

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "vacancy"
  );
}

export async function createVacancy(admin: AdminClient, actor: Actor, input: VacancyInput): Promise<string> {
  const base = slugify(input.title);
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data } = await admin.from("hr_vacancies").select("id").eq("slug", slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${i}`;
  }
  const { data, error } = await admin
    .from("hr_vacancies")
    .insert({ ...input, slug, created_by: actor.id })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the vacancy");
  await audit(admin, actor, { action: "vacancy_created", entityType: "hr_vacancy", entityId: data.id, campusId: input.campus_id, after: input as unknown as Json });
  await seedQuestionsFromBank(admin, data.id, input.phase);
  return data.id;
}

export async function updateVacancy(admin: AdminClient, actor: Actor, id: string, input: VacancyInput): Promise<void> {
  const { data: before } = await admin.from("hr_vacancies").select("*").eq("id", id).single();
  if (!before) throw new HrError("Vacancy not found.");
  // The phase decides the question bank; changing it after applicants have
  // answered would leave their answers against the wrong questions.
  if (before.status !== "draft" && input.phase !== before.phase) throw new HrError("The phase cannot change once the vacancy is published.");
  const { error } = await admin.from("hr_vacancies").update(input).eq("id", id);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "vacancy_updated", entityType: "hr_vacancy", entityId: id, campusId: input.campus_id, before: before as unknown as Json, after: input as unknown as Json });
}

async function loadBank(admin: AdminClient, phase: Phase): Promise<(BankQuestionForDraft & { id: string; guidance: string | null })[]> {
  const { data: bank } = await admin.from("hr_question_banks").select("id").eq("phase", phase).eq("is_active", true).maybeSingle();
  if (!bank) return [];
  const { data: questions } = await admin
    .from("hr_bank_questions")
    .select("*")
    .eq("bank_id", bank.id)
    .eq("is_active", true)
    .order("sort_order");
  return (questions ?? []).flatMap((q) => {
    const rubric = parseRubric(q.rubric);
    return rubric ? [{ id: q.id, code: q.code, kind: q.kind, competency: q.competency, prompt: q.prompt, rubric, word_limit: q.word_limit, guidance: q.guidance }] : [];
  });
}

/** A new vacancy starts with its phase's core questions, as drafts for a person to approve. */
export async function seedQuestionsFromBank(admin: AdminClient, vacancyId: string, phase: Phase): Promise<void> {
  const bank = await loadBank(admin, phase);
  const core = bank.filter((q) => q.kind === "core");
  if (!core.length) return;
  const { error } = await admin.from("hr_vacancy_questions").insert(
    core.map((q, i) => ({
      vacancy_id: vacancyId,
      source_bank_question_id: q.id,
      prompt: q.prompt,
      competency: q.competency as never,
      rubric: q.rubric as unknown as Json,
      word_limit: q.word_limit,
      origin: "bank" as const,
      sort_order: (i + 1) * 10,
    }))
  );
  if (error) throw new Error(error.message);
}

/** Replaces the draft questions with the AI's tailored draft. Nothing is approved by this. */
export async function draftQuestionsWithAi(admin: AdminClient, actor: Actor, vacancyId: string): Promise<{ source: "ai" | "bank"; note: string | null }> {
  const { data: vacancy } = await admin.from("hr_vacancies").select("*").eq("id", vacancyId).single();
  if (!vacancy) throw new HrError("Vacancy not found.");
  if (vacancy.status !== "draft") throw new HrError("Questions cannot change once the vacancy is published.");
  const { data: campus } = await admin.from("campuses").select("country").eq("id", vacancy.campus_id).single();
  const bank = await loadBank(admin, vacancy.phase);
  if (!bank.length) throw new HrError("There is no question bank for this phase yet. Add questions by hand.");

  const draft = await draftVacancyQuestions({
    title: vacancy.title,
    phase: vacancy.phase,
    subject: vacancy.subject,
    gradeRange: vacancy.grade_range,
    country: campus?.country ?? "BW",
    bank,
  });
  const byCode = new Map(bank.map((q) => [q.code, q.id]));
  const { error: delError } = await admin.from("hr_vacancy_questions").delete().eq("vacancy_id", vacancyId).eq("status", "draft");
  if (delError) throw new Error(delError.message);
  const { data: kept } = await admin.from("hr_vacancy_questions").select("sort_order").eq("vacancy_id", vacancyId);
  const start = Math.max(0, ...(kept ?? []).map((k) => k.sort_order));
  const { error } = await admin.from("hr_vacancy_questions").insert(
    draft.questions.map((q, i) => ({
      vacancy_id: vacancyId,
      source_bank_question_id: q.sourceCode ? byCode.get(q.sourceCode) ?? null : null,
      prompt: q.prompt,
      competency: q.competency,
      rubric: q.rubric as unknown as Json,
      word_limit: q.wordLimit,
      origin: draft.source === "ai" && !q.sourceCode ? ("ai" as const) : ("bank" as const),
      ai_rationale: draft.source === "ai" ? q.rationale : null,
      sort_order: start + (i + 1) * 10,
    }))
  );
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "questions_drafted", entityType: "hr_vacancy", entityId: vacancyId, campusId: vacancy.campus_id, after: { source: draft.source, count: draft.questions.length } });
  return { source: draft.source, note: draft.note };
}

export const QuestionEditSchema = z.object({
  prompt: z.string().trim().min(10).max(500),
  competency: z.enum([
    "safeguarding",
    "pedagogy",
    "classroom_management",
    "inclusion",
    "communication",
    "professionalism",
    "subject_knowledge",
    "early_years_practice",
    "assessment",
    "teamwork",
  ]),
  word_limit: z.coerce.number().int().min(50).max(800),
  rubric: RubricSchema,
});

async function draftVacancy(admin: AdminClient, vacancyId: string) {
  const { data: vacancy } = await admin.from("hr_vacancies").select("*").eq("id", vacancyId).single();
  if (!vacancy) throw new HrError("Vacancy not found.");
  if (vacancy.status !== "draft") throw new HrError("Questions cannot change once the vacancy is published.");
  return vacancy;
}

export async function saveQuestion(
  admin: AdminClient,
  actor: Actor,
  vacancyId: string,
  questionId: string | null,
  input: z.infer<typeof QuestionEditSchema>
): Promise<void> {
  await draftVacancy(admin, vacancyId);
  if (questionId) {
    // An edit takes the question back to draft: what was approved is not what is there now.
    const { error } = await admin
      .from("hr_vacancy_questions")
      .update({ ...input, rubric: input.rubric as unknown as Json, status: "draft", approved_by: null, approved_at: null })
      .eq("id", questionId)
      .eq("vacancy_id", vacancyId);
    if (error) throw new Error(error.message);
  } else {
    const { data: last } = await admin.from("hr_vacancy_questions").select("sort_order").eq("vacancy_id", vacancyId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { error } = await admin.from("hr_vacancy_questions").insert({
      vacancy_id: vacancyId,
      ...input,
      rubric: input.rubric as unknown as Json,
      origin: "manual",
      sort_order: (last?.sort_order ?? 0) + 10,
    });
    if (error) throw new Error(error.message);
  }
  await audit(admin, actor, { action: questionId ? "question_edited" : "question_added", entityType: "hr_vacancy", entityId: vacancyId });
}

export async function setQuestionApproval(admin: AdminClient, actor: Actor, vacancyId: string, questionIds: string[], approve: boolean): Promise<void> {
  await draftVacancy(admin, vacancyId);
  const { error } = await admin
    .from("hr_vacancy_questions")
    .update(approve ? { status: "approved", approved_by: actor.id, approved_at: new Date().toISOString() } : { status: "draft", approved_by: null, approved_at: null })
    .eq("vacancy_id", vacancyId)
    .in("id", questionIds);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: approve ? "questions_approved" : "questions_unapproved", entityType: "hr_vacancy", entityId: vacancyId, after: { count: questionIds.length } });
}

export async function deleteQuestion(admin: AdminClient, actor: Actor, vacancyId: string, questionId: string): Promise<void> {
  await draftVacancy(admin, vacancyId);
  const { error } = await admin.from("hr_vacancy_questions").delete().eq("id", questionId).eq("vacancy_id", vacancyId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "question_deleted", entityType: "hr_vacancy", entityId: vacancyId });
}

export async function moveQuestion(admin: AdminClient, vacancyId: string, questionId: string, direction: "up" | "down"): Promise<void> {
  await draftVacancy(admin, vacancyId);
  const { data: all } = await admin.from("hr_vacancy_questions").select("id, sort_order").eq("vacancy_id", vacancyId).order("sort_order");
  const list = all ?? [];
  const i = list.findIndex((q) => q.id === questionId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) {
    await admin.from("hr_vacancy_questions").update({ sort_order: (k + 1) * 10 }).eq("id", list[k].id);
  }
}

/**
 * Publishing: every question approved, at least one of them about
 * safeguarding, and the weights frozen as they stand today.
 */
export async function publishVacancy(admin: AdminClient, actor: Actor, vacancyId: string): Promise<void> {
  const vacancy = await draftVacancy(admin, vacancyId);
  const { data: questions } = await admin.from("hr_vacancy_questions").select("status, competency").eq("vacancy_id", vacancyId);
  const list = questions ?? [];
  if (list.length < 3) throw new HrError("Add at least three questions before publishing.");
  if (list.some((q) => q.status !== "approved")) throw new HrError("Approve or delete every draft question before publishing.");
  if (vacancy.phase !== "general" && !list.some((q) => q.competency === "safeguarding")) {
    throw new HrError("A teaching vacancy needs at least one safeguarding question.");
  }
  if (!vacancy.closes_on) throw new HrError("Set a closing date before publishing.");
  const settings = await getHrSettings(admin);
  const { error } = await admin
    .from("hr_vacancies")
    .update({ status: "published", published_at: new Date().toISOString(), published_by: actor.id, scoring_weights: settings.scoringWeights as unknown as Json })
    .eq("id", vacancyId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "vacancy_published", entityType: "hr_vacancy", entityId: vacancyId, campusId: vacancy.campus_id });
}

export async function setVacancyStatus(admin: AdminClient, actor: Actor, vacancyId: string, to: "closed" | "archived" | "published"): Promise<void> {
  const { data: vacancy } = await admin.from("hr_vacancies").select("*").eq("id", vacancyId).single();
  if (!vacancy) throw new HrError("Vacancy not found.");
  if (vacancy.status === "draft") throw new HrError("Publish the vacancy first.");
  const { error } = await admin.from("hr_vacancies").update({ status: to }).eq("id", vacancyId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: `vacancy_${to}`, entityType: "hr_vacancy", entityId: vacancyId, campusId: vacancy.campus_id });
}
