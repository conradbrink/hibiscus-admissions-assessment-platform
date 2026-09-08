import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { AnswerMode, Json, QuestionType } from "@/lib/supabase/types";

/**
 * What the kiosk receives: the form, without keys.
 *
 * ⚠️ This module never names form_answer_keys or question_answers, and the
 * types below have no field an answer could travel in. lib/assessment/
 * delivery.test.ts reads this file and fails if either table name appears.
 * See web/AGENTS.md, "Answers never leave the server".
 */

export type DeliveryOption = {
  id: string;
  label: string;
  mediaPath: string | null;
  side: "left" | "right" | null;
};

export type DeliveryQuestion = {
  id: string;
  sectionPosition: number;
  position: number;
  isPractice: boolean;
  type: QuestionType;
  stem: string;
  stemMediaPath: string | null;
  passage: { title: string; body: string; mediaPath: string | null } | null;
  options: DeliveryOption[];
  marks: number;
  /** Which strand the item belongs to; story mode stops a strand after a run of misses. */
  competencyId: string;
  difficulty: number;
  /** Story mode: what the character says, how the child answers, what the scene highlights, what the adult looks for. */
  narration: string | null;
  answerMode: AnswerMode | null;
  sceneFocus: string[];
  adultNote: string | null;
};

export type DeliverySection = {
  position: number;
  title: string;
  instructions: string | null;
  timeLimitSeconds: number | null;
  /** Story mode: the drawn scene, the character's opening line, the stop rule. */
  sceneKey: string | null;
  narration: string | null;
  stopAfterMisses: number | null;
  questions: DeliveryQuestion[];
};

export type DeliveryForm = {
  formId: string;
  sections: DeliverySection[];
  /** Marked questions only, for the progress bar. */
  totalQuestions: number;
};

const DELIVERY_SELECT =
  "id, section_position, section_title, section_instructions, section_time_limit_seconds, section_scene_key, section_narration, section_stop_after_misses, is_practice, position, type, stem, stem_media_path, passage_snapshot, options, marks, competency_id, difficulty, narration, answer_mode, scene_focus, adult_note";

function asOptions(json: Json): DeliveryOption[] {
  if (!Array.isArray(json)) return [];
  const out: DeliveryOption[] = [];
  for (const o of json) {
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const r = o as Record<string, Json | undefined>;
    if (typeof r.id !== "string" || typeof r.label !== "string") continue;
    out.push({
      id: r.id,
      label: r.label,
      mediaPath: typeof r.media_path === "string" ? r.media_path : null,
      side: r.side === "left" || r.side === "right" ? r.side : null,
    });
  }
  return out;
}

function asPassage(json: Json | null): DeliveryQuestion["passage"] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const r = json as Record<string, Json | undefined>;
  if (typeof r.title !== "string" || typeof r.body !== "string") return null;
  return { title: r.title, body: r.body, mediaPath: typeof r.media_path === "string" ? r.media_path : null };
}

export async function loadDeliveryForm(admin: AdminClient, formId: string): Promise<DeliveryForm> {
  const { data, error } = await admin
    .from("form_questions")
    .select(DELIVERY_SELECT)
    .eq("form_id", formId)
    .order("section_position")
    .order("position");
  if (error) throw new Error(error.message);

  const sections = new Map<number, DeliverySection>();
  let total = 0;
  for (const row of data ?? []) {
    const section = sections.get(row.section_position) ?? {
      position: row.section_position,
      title: row.section_title,
      instructions: row.section_instructions,
      timeLimitSeconds: row.section_time_limit_seconds,
      sceneKey: row.section_scene_key,
      narration: row.section_narration,
      stopAfterMisses: row.section_stop_after_misses,
      questions: [],
    };
    section.questions.push({
      id: row.id,
      sectionPosition: row.section_position,
      position: row.position,
      isPractice: row.is_practice,
      type: row.type,
      stem: row.stem,
      stemMediaPath: row.stem_media_path,
      passage: asPassage(row.passage_snapshot),
      options: asOptions(row.options),
      marks: Number(row.marks),
      competencyId: row.competency_id,
      difficulty: row.difficulty,
      narration: row.narration,
      answerMode: row.answer_mode,
      sceneFocus: row.scene_focus ?? [],
      adultNote: row.adult_note,
    });
    if (!row.is_practice) total += 1;
    sections.set(row.section_position, section);
  }
  return { formId, sections: [...sections.values()].sort((a, b) => a.position - b.position), totalQuestions: total };
}
