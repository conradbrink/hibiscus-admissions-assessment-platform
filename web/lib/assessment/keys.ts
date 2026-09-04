import { z } from "zod";
import type { Json, QuestionType } from "@/lib/supabase/types";

/**
 * The shape of an answer key, per question type.
 *
 * Pure: shared by the authoring action (which refuses to save a malformed
 * key) and the marker (which treats a malformed key as "cannot mark" rather
 * than "wrong"). Neither the kiosk nor any delivery code imports this file —
 * it would have no reason to, and a grep for it under app/(kiosk) is one of
 * the tests.
 *
 * `ordering` has no stored key: the authored option order *is* the correct
 * order, and the kiosk shuffles what it shows. That removes a whole class
 * of "the key disagrees with the options" mistakes.
 */

const uuid = z.uuid();

export const ANSWER_KEY_SCHEMAS = {
  single_choice: z.object({ option_ids: z.array(uuid).length(1) }),
  multi_select: z.object({ option_ids: z.array(uuid).min(1) }),
  numeric: z.object({ value: z.number().finite(), tolerance: z.number().min(0).default(0) }),
  short_text: z.object({ accepted: z.array(z.string().trim().min(1).max(200)).min(1) }),
  matching: z.object({ pairs: z.array(z.tuple([uuid, uuid])).min(1) }),
  ordering: z.object({ order: z.array(uuid).min(2) }),
} as const;

export type SingleChoiceKey = z.infer<typeof ANSWER_KEY_SCHEMAS.single_choice>;
export type MultiSelectKey = z.infer<typeof ANSWER_KEY_SCHEMAS.multi_select>;
export type NumericKey = z.infer<typeof ANSWER_KEY_SCHEMAS.numeric>;
export type ShortTextKey = z.infer<typeof ANSWER_KEY_SCHEMAS.short_text>;
export type MatchingKey = z.infer<typeof ANSWER_KEY_SCHEMAS.matching>;
export type OrderingKey = z.infer<typeof ANSWER_KEY_SCHEMAS.ordering>;

export type AnswerKey =
  | { type: "single_choice"; key: SingleChoiceKey }
  | { type: "multi_select"; key: MultiSelectKey }
  | { type: "numeric"; key: NumericKey }
  | { type: "short_text"; key: ShortTextKey }
  | { type: "matching"; key: MatchingKey }
  | { type: "ordering"; key: OrderingKey };

/** Null when the JSON is not a valid key for this type. */
export function parseAnswerKey(type: QuestionType, json: Json | null | undefined): AnswerKey | null {
  if (type === "extended_text" || json === null || json === undefined) return null;
  const schema = ANSWER_KEY_SCHEMAS[type];
  const result = schema.safeParse(json);
  if (!result.success) return null;
  return { type, key: result.data } as AnswerKey;
}

/** Which types are marked by a person against a rubric rather than by code. */
export function needsRubric(type: QuestionType): boolean {
  return type === "extended_text";
}

/** Which types carry options. */
export function hasOptions(type: QuestionType): boolean {
  return type === "single_choice" || type === "multi_select" || type === "matching" || type === "ordering";
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "Single choice",
  multi_select: "Multiple select",
  numeric: "Number",
  short_text: "Short answer",
  matching: "Matching",
  ordering: "Ordering",
  extended_text: "Extended writing",
};

export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[];
