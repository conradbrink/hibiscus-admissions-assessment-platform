"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * Assessment templates: what a sitting is made of.
 *
 * A template can be edited freely while a draft. Activating it is what
 * makes it resolvable at launch; the checks at activation are the ones that
 * would otherwise fail on assessment day in front of a child.
 */

const templatePath = (id: string) => `/staff/admin/assessment-templates/${id}`;

const templateMeta = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  gradeSortMin: z.coerce.number().int(),
  gradeSortMax: z.coerce.number().int(),
  campusId: z.string().optional(),
  timeLimitMinutes: z.coerce.number().int().min(5).max(300),
  delivery: z.enum(["paper", "story"]).default("paper"),
  storyCharacter: z.string().trim().max(60).optional(),
});

export async function createTemplate(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = templateMeta.parse(Object.fromEntries(formData));
    if (p.gradeSortMax < p.gradeSortMin) throw new Error("The grade band is upside down.");
    const { error } = await ctx.supabase.from("assessment_templates").insert({
      name: p.name,
      description: p.description || null,
      grade_sort_min: p.gradeSortMin,
      grade_sort_max: p.gradeSortMax,
      campus_id: p.campusId || null,
      time_limit_minutes: p.timeLimitMinutes,
      delivery: p.delivery,
      story_character: p.storyCharacter || null,
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/assessment-templates");
  });
}

export async function saveTemplate(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = templateMeta.extend({ templateId: z.uuid() }).parse(Object.fromEntries(formData));
    if (p.gradeSortMax < p.gradeSortMin) throw new Error("The grade band is upside down.");
    const { error } = await ctx.supabase
      .from("assessment_templates")
      .update({
        name: p.name,
        description: p.description || null,
        grade_sort_min: p.gradeSortMin,
        grade_sort_max: p.gradeSortMax,
        campus_id: p.campusId || null,
        time_limit_minutes: p.timeLimitMinutes,
        delivery: p.delivery,
        story_character: p.storyCharacter || null,
      })
      .eq("id", p.templateId);
    if (error) throw new Error(error.message);
    revalidatePath(templatePath(p.templateId));
    revalidatePath("/staff/admin/assessment-templates");
  });
}

/**
 * Activation checks: at least one section; every fixed section has a
 * question; every random section names a count; every fixed question is
 * active. Retiring needs no checks.
 */
export async function setTemplateStatus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z.object({ templateId: z.uuid(), status: z.enum(["draft", "active", "retired"]) }).parse(Object.fromEntries(formData));
    if (p.status === "active") {
      const { data: sections } = await ctx.supabase
        .from("template_sections")
        .select("id, title, selection, random_count, template_section_questions(question_id, questions(status))")
        .eq("template_id", p.templateId);
      if (!sections?.length) throw new Error("Add at least one section before activating.");
      for (const s of sections) {
        const picks = s.template_section_questions ?? [];
        if (s.selection === "fixed" && !picks.length) throw new Error(`Section "${s.title}" has no questions.`);
        if (s.selection === "random" && !s.random_count) throw new Error(`Section "${s.title}" needs a number of questions to draw.`);
        for (const pick of picks) {
          const q = Array.isArray(pick.questions) ? pick.questions[0] : pick.questions;
          if ((q as { status: string } | null)?.status !== "active") {
            throw new Error(`Section "${s.title}" includes a question that is not active.`);
          }
        }
      }
    }
    const { error } = await ctx.supabase.from("assessment_templates").update({ status: p.status }).eq("id", p.templateId);
    if (error) throw new Error(error.message);
    revalidatePath(templatePath(p.templateId));
    revalidatePath("/staff/admin/assessment-templates");
  });
}

const sectionSchema = z.object({
  templateId: z.uuid(),
  sectionId: z.uuid().optional().or(z.literal("")),
  position: z.coerce.number().int().min(1).max(50),
  title: z.string().trim().min(1).max(120),
  subjectId: z.uuid(),
  instructions: z.string().trim().max(2000).optional(),
  timeLimitMinutes: z.union([z.literal(""), z.coerce.number().int().min(1).max(300)]).optional(),
  selection: z.enum(["fixed", "random"]),
  randomCount: z.union([z.literal(""), z.coerce.number().int().min(1).max(100)]).optional(),
  randomMix: z.string().trim().max(200).optional(),
  practiceQuestionId: z.string().optional(),
  sceneKey: z.string().trim().max(60).optional(),
  narration: z.string().trim().max(2000).optional(),
  stopAfterMisses: z.union([z.literal(""), z.coerce.number().int().min(1).max(10)]).optional(),
});

/** The difficulty mix is typed as "1:2, 3:4" and stored as {"1":2,"3":4}. */
function parseMix(text: string | undefined): Record<string, number> | null {
  if (!text) return null;
  const out: Record<string, number> = {};
  for (const part of text.split(",")) {
    const [d, n] = part.split(":").map((s) => s.trim());
    const diff = Number(d);
    const count = Number(n);
    if (!Number.isInteger(diff) || diff < 1 || diff > 5 || !Number.isInteger(count) || count < 0) {
      throw new Error('Difficulty mix looks like "2:3, 3:4, 4:3" — difficulty:count pairs.');
    }
    out[String(diff)] = count;
  }
  return out;
}

export async function saveSection(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = sectionSchema.parse(Object.fromEntries(formData));
    const row = {
      template_id: p.templateId,
      position: p.position,
      title: p.title,
      subject_id: p.subjectId,
      instructions: p.instructions || null,
      time_limit_minutes: p.timeLimitMinutes === "" || p.timeLimitMinutes === undefined ? null : p.timeLimitMinutes,
      selection: p.selection,
      random_count: p.randomCount === "" || p.randomCount === undefined ? null : p.randomCount,
      random_difficulty_mix: parseMix(p.randomMix),
      practice_question_id: p.practiceQuestionId || null,
      scene_key: p.sceneKey || null,
      narration: p.narration || null,
      stop_after_misses: p.stopAfterMisses === "" || p.stopAfterMisses === undefined ? null : p.stopAfterMisses,
    };
    const { error } = p.sectionId
      ? await ctx.supabase.from("template_sections").update(row).eq("id", p.sectionId)
      : await ctx.supabase.from("template_sections").insert(row);
    if (error) throw new Error(error.message.includes("unique") ? "Two sections cannot share a position." : error.message);
    revalidatePath(templatePath(p.templateId));
  });
}

export async function deleteSection(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z.object({ templateId: z.uuid(), sectionId: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("template_sections").delete().eq("id", p.sectionId);
    if (error) throw new Error(error.message);
    revalidatePath(templatePath(p.templateId));
  });
}

/** Replaces a fixed section's question list with what was ticked, in tick order. */
export async function saveSectionQuestions(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z.object({ templateId: z.uuid(), sectionId: z.uuid() }).parse({
      templateId: formData.get("templateId"),
      sectionId: formData.get("sectionId"),
    });
    const ids = formData.getAll("questionIds").filter((v): v is string => typeof v === "string");
    await ctx.supabase.from("template_section_questions").delete().eq("section_id", p.sectionId);
    if (ids.length) {
      const { error } = await ctx.supabase
        .from("template_section_questions")
        .insert(ids.map((question_id, i) => ({ section_id: p.sectionId, question_id, position: i + 1 })));
      if (error) throw new Error(error.message);
    }
    revalidatePath(templatePath(p.templateId));
  });
}

export type RecordVoiceState = {
  /** How many distinct lines the chapter says, stock lines included. */
  total: number;
  /** How many of them have a recording after this call. */
  recorded: number;
  done: boolean;
  error?: string;
  /** No voice provider is configured, so there is nothing to record. */
  unavailable?: boolean;
};

/**
 * Records a story chapter's lines ahead of a sitting, a few per call so a
 * long chapter never outlasts one request. The button on the template
 * page keeps calling until `done`. Every line is cached by its text, so a
 * line shared between chapters is recorded once.
 */
export async function recordStoryVoice(templateId: string): Promise<RecordVoiceState> {
  try {
    return await recordBatch(templateId);
  } catch (e) {
    return { total: 0, recorded: 0, done: false, error: e instanceof Error ? e.message : "Recording failed." };
  }
}

/** A few lines per call: each synthesis takes a second or two and a request has a time limit. */
const BATCH = 3;

async function recordBatch(templateId: string): Promise<RecordVoiceState> {
  const ctx = await requireStaffAction("assessments.author");
  const [{ storyVoiceProvider, narrationAudio, recordedPaths, voiceObjectPath }, { STOCK_LINES, normaliseNarration }] = await Promise.all([
    import("@/lib/assessment/story-voice"),
    import("@/lib/assessment/story"),
  ]);
  if (storyVoiceProvider() !== "elevenlabs") return { total: 0, recorded: 0, done: true, unavailable: true };

  const { data: sections } = await ctx.supabase
    .from("template_sections")
    .select("narration, title, template_section_questions(questions(narration, stem))")
    .eq("template_id", templateId);
  const lines = new Set<string>(STOCK_LINES.map(normaliseNarration));
  for (const s of sections ?? []) {
    lines.add(normaliseNarration(s.narration ?? s.title));
    for (const tsq of s.template_section_questions ?? []) {
      const q = Array.isArray(tsq.questions) ? tsq.questions[0] : tsq.questions;
      if (q) lines.add(normaliseNarration(q.narration ?? q.stem));
    }
  }
  lines.delete("");

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const have = await recordedPaths(admin);
  const missing = [...lines].filter((line) => !have.has(voiceObjectPath(line)));
  let recorded = lines.size - missing.length;
  try {
    for (const line of missing.slice(0, BATCH)) {
      await narrationAudio(admin, line);
      recorded += 1;
    }
  } catch (e) {
    return { total: lines.size, recorded, done: false, error: e instanceof Error ? e.message : "The voice service refused." };
  }
  return { total: lines.size, recorded, done: recorded >= lines.size };
}
