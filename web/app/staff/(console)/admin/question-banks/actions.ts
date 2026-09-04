"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { ANSWER_KEY_SCHEMAS, QUESTION_TYPES, hasOptions, needsRubric } from "@/lib/assessment/keys";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import type { Json, QuestionType } from "@/lib/supabase/types";

/**
 * Authoring: banks, passages, questions, options and keys.
 *
 * Everything writes through the RLS client, so a person without
 * assessments.author is refused by the database, not by this file. The key
 * is validated against the per-type schema before it is stored, because a
 * malformed key surfaces on assessment day as a response nobody can mark.
 */

const bankPath = (bankId: string) => `/staff/admin/question-banks/${bankId}`;
const questionPath = (bankId: string, questionId: string) => `${bankPath(bankId)}/questions/${questionId}`;

function optionalId(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Banks
// ---------------------------------------------------------------------------

export async function createBank(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z
      .object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(400).optional() })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("question_banks")
      .insert({ name: p.name, description: p.description || null, created_by: ctx.userId });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/question-banks");
  });
}

export async function setBankStatus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z.object({ bankId: z.uuid(), status: z.enum(["draft", "active", "retired"]) }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("question_banks").update({ status: p.status }).eq("id", p.bankId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/question-banks");
    revalidatePath(bankPath(p.bankId));
  });
}

// ---------------------------------------------------------------------------
// Passages
// ---------------------------------------------------------------------------

export async function savePassage(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z
      .object({
        bankId: z.uuid(),
        passageId: z.uuid().optional().or(z.literal("")),
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(20_000),
        mediaPath: z.string().trim().max(400).optional(),
      })
      .parse(Object.fromEntries(formData));
    const row = { bank_id: p.bankId, title: p.title, body: p.body, media_path: p.mediaPath || null };
    const { error } = p.passageId
      ? await ctx.supabase.from("passages").update(row).eq("id", p.passageId)
      : await ctx.supabase.from("passages").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath(bankPath(p.bankId));
  });
}

export async function deletePassage(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z.object({ bankId: z.uuid(), passageId: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("passages").delete().eq("id", p.passageId);
    if (error) throw new Error(error.message);
    revalidatePath(bankPath(p.bankId));
  });
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const questionMeta = z.object({
  bankId: z.uuid(),
  competencyId: z.uuid(),
  type: z.enum(QUESTION_TYPES as [QuestionType, ...QuestionType[]]),
  stem: z.string().trim().min(1).max(4000),
  stemMediaPath: z.string().trim().max(400).optional(),
  passageId: z.string().optional(),
  marks: z.coerce.number().positive().max(100),
  difficulty: z.coerce.number().int().min(1).max(5),
  gradeSortMin: z.union([z.literal(""), z.coerce.number().int()]).optional(),
  gradeSortMax: z.union([z.literal(""), z.coerce.number().int()]).optional(),
});

export async function createQuestion(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = questionMeta.parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("questions").insert({
      bank_id: p.bankId,
      competency_id: p.competencyId,
      type: p.type,
      stem: p.stem,
      stem_media_path: p.stemMediaPath || null,
      passage_id: optionalId(p.passageId),
      marks: p.marks,
      difficulty: p.difficulty,
      grade_sort_min: p.gradeSortMin === "" || p.gradeSortMin === undefined ? null : p.gradeSortMin,
      grade_sort_max: p.gradeSortMax === "" || p.gradeSortMax === undefined ? null : p.gradeSortMax,
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath(bankPath(p.bankId));
  });
}

export async function saveQuestion(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = questionMeta.extend({ questionId: z.uuid() }).parse(Object.fromEntries(formData));
    const { data, error } = await ctx.supabase
      .from("questions")
      .update({
        competency_id: p.competencyId,
        stem: p.stem,
        stem_media_path: p.stemMediaPath || null,
        passage_id: optionalId(p.passageId),
        marks: p.marks,
        difficulty: p.difficulty,
        grade_sort_min: p.gradeSortMin === "" || p.gradeSortMin === undefined ? null : p.gradeSortMin,
        grade_sort_max: p.gradeSortMax === "" || p.gradeSortMax === undefined ? null : p.gradeSortMax,
      })
      .eq("id", p.questionId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nothing was saved — you may not have permission to author questions.");
    revalidatePath(questionPath(p.bankId, p.questionId));
    revalidatePath(bankPath(p.bankId));
  });
}

/**
 * Activating requires a usable key: a draft can be half-finished, an active
 * question is offered to children.
 */
export async function setQuestionStatus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z
      .object({ bankId: z.uuid(), questionId: z.uuid(), status: z.enum(["draft", "active", "retired"]) })
      .parse(Object.fromEntries(formData));
    if (p.status === "active") {
      const [{ data: q }, { data: key }] = await Promise.all([
        ctx.supabase.from("questions").select("type").eq("id", p.questionId).single(),
        ctx.supabase.from("question_answers").select("answer, rubric_id").eq("question_id", p.questionId).maybeSingle(),
      ]);
      if (!q) throw new Error("Question not found.");
      if (needsRubric(q.type)) {
        if (!key?.rubric_id) throw new Error("Choose a rubric before activating a writing question.");
      } else if (q.type !== "ordering") {
        const parsed = key ? ANSWER_KEY_SCHEMAS[q.type as Exclude<QuestionType, "extended_text">].safeParse(key.answer) : null;
        if (!parsed?.success) throw new Error("Save a complete answer key before activating.");
      } else {
        const { count } = await ctx.supabase
          .from("question_options")
          .select("id", { count: "exact", head: true })
          .eq("question_id", p.questionId);
        if ((count ?? 0) < 2) throw new Error("An ordering question needs at least two options.");
      }
    }
    const { error } = await ctx.supabase.from("questions").update({ status: p.status }).eq("id", p.questionId);
    if (error) throw new Error(error.message);
    revalidatePath(questionPath(p.bankId, p.questionId));
    revalidatePath(bankPath(p.bankId));
  });
}

export async function deleteQuestion(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z.object({ bankId: z.uuid(), questionId: z.uuid() }).parse(Object.fromEntries(formData));
    const { data, error } = await ctx.supabase.from("questions").delete().eq("id", p.questionId).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Only a draft question can be deleted. Retire it instead.");
    revalidatePath(bankPath(p.bankId));
  });
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export async function addOption(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z
      .object({
        bankId: z.uuid(),
        questionId: z.uuid(),
        label: z.string().trim().min(1).max(500),
        side: z.enum(["left", "right", ""]).optional(),
        mediaPath: z.string().trim().max(400).optional(),
      })
      .parse(Object.fromEntries(formData));
    const { data: q } = await ctx.supabase.from("questions").select("type").eq("id", p.questionId).single();
    if (!q || !hasOptions(q.type)) throw new Error("This question type has no options.");
    const side = q.type === "matching" ? (p.side === "right" ? "right" : "left") : null;
    const { data: existing } = await ctx.supabase
      .from("question_options")
      .select("position")
      .eq("question_id", p.questionId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (existing?.[0]?.position ?? 0) + 1;
    const { error } = await ctx.supabase
      .from("question_options")
      .insert({ question_id: p.questionId, position, label: p.label, side, media_path: p.mediaPath || null });
    if (error) throw new Error(error.message);
    revalidatePath(questionPath(p.bankId, p.questionId));
  });
}

export async function saveOption(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z
      .object({
        bankId: z.uuid(),
        questionId: z.uuid(),
        optionId: z.uuid(),
        label: z.string().trim().min(1).max(500),
        position: z.coerce.number().int().min(1).max(50),
      })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("question_options")
      .update({ label: p.label, position: p.position })
      .eq("id", p.optionId);
    if (error) throw new Error(error.message.includes("unique") ? "Two options cannot share a position." : error.message);
    revalidatePath(questionPath(p.bankId, p.questionId));
  });
}

export async function deleteOption(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z.object({ bankId: z.uuid(), questionId: z.uuid(), optionId: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("question_options").delete().eq("id", p.optionId);
    if (error) throw new Error(error.message);
    revalidatePath(questionPath(p.bankId, p.questionId));
  });
}

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

/**
 * Builds the key from the form fields the editor shows for this type, then
 * validates it against the type's schema. For `ordering` the authored option
 * order is the key and there is nothing to store beyond partial credit.
 */
export async function saveKey(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const base = z.object({ bankId: z.uuid(), questionId: z.uuid() }).parse({
      bankId: formData.get("bankId"),
      questionId: formData.get("questionId"),
    });
    const { data: q } = await ctx.supabase.from("questions").select("type").eq("id", base.questionId).single();
    if (!q) throw new Error("Question not found.");
    const partialCredit = formData.get("partialCredit") === "1";

    let answer: Json | null = null;
    let rubricId: string | null = null;
    switch (q.type) {
      case "single_choice": {
        const id = formData.get("correctOptionId");
        answer = ANSWER_KEY_SCHEMAS.single_choice.parse({ option_ids: id ? [id] : [] });
        break;
      }
      case "multi_select": {
        const ids = formData.getAll("correctOptionIds").filter((v): v is string => typeof v === "string");
        answer = ANSWER_KEY_SCHEMAS.multi_select.parse({ option_ids: ids });
        break;
      }
      case "numeric": {
        const value = Number(formData.get("numericValue"));
        const tolerance = Number(formData.get("numericTolerance") || 0);
        answer = ANSWER_KEY_SCHEMAS.numeric.parse({ value, tolerance });
        break;
      }
      case "short_text": {
        const accepted = String(formData.get("acceptedAnswers") ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        answer = ANSWER_KEY_SCHEMAS.short_text.parse({ accepted });
        break;
      }
      case "matching": {
        const pairs: [string, string][] = [];
        for (const [name, value] of formData.entries()) {
          if (name.startsWith("pair_") && typeof value === "string" && value) {
            pairs.push([name.slice(5), value]);
          }
        }
        answer = ANSWER_KEY_SCHEMAS.matching.parse({ pairs });
        break;
      }
      case "ordering": {
        const { data: opts } = await ctx.supabase
          .from("question_options")
          .select("id")
          .eq("question_id", base.questionId)
          .order("position");
        answer = ANSWER_KEY_SCHEMAS.ordering.parse({ order: (opts ?? []).map((o) => o.id) });
        break;
      }
      case "extended_text": {
        rubricId = z.uuid().parse(formData.get("rubricId"));
        break;
      }
    }

    const { error } = await ctx.supabase.from("question_answers").upsert(
      { question_id: base.questionId, answer, partial_credit: partialCredit, rubric_id: rubricId },
      { onConflict: "question_id" }
    );
    if (error) throw new Error(error.message);
    revalidatePath(questionPath(base.bankId, base.questionId));
  });
}
