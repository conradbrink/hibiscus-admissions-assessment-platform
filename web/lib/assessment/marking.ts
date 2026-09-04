import type { AnswerKey } from "@/lib/assessment/keys";
import type { Json, QuestionType } from "@/lib/supabase/types";

/**
 * Marks one response against one key. Pure, and the only place the rules
 * for "is this right" live, so they are unit tested per type and identical
 * whether the marker runs from the job drain or from a staff re-mark.
 *
 * Response shapes, as the kiosk submits them:
 *   single_choice  { option_id }
 *   multi_select   { option_ids: [] }
 *   numeric        { value }              — number, or a string the child typed
 *   short_text     { text }
 *   matching       { pairs: [[left, right], …] }
 *   ordering       { order: [] }
 *   extended_text  { text }
 *
 * A response the marker cannot interpret earns zero, not an error: a child
 * who typed "twelve apples" into a number box got it wrong, and the attempt
 * still completes. A *key* the marker cannot interpret is different — that is
 * an authoring fault, reported as `unmarkable` so a person fixes it.
 */

export type MarkResult =
  | { status: "marked"; isCorrect: boolean; marksAwarded: number }
  | { status: "needs_rubric" }
  | { status: "unmarkable"; reason: string };

function obj(v: Json | null | undefined): Record<string, Json | undefined> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : null;
}

function strings(v: Json | undefined): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

/** "Twelve." / " twelve " / "TWELVE" all compare equal. */
export function normaliseText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();
}

function parseNumber(v: Json | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, ".").replace(/\s+/g, "");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function markResponse(
  type: QuestionType,
  key: AnswerKey | null,
  response: Json | null,
  marks: number,
  partialCredit: boolean
): MarkResult {
  if (type === "extended_text") return { status: "needs_rubric" };
  if (!key || key.type !== type) return { status: "unmarkable", reason: `No valid key for a ${type} question` };
  const r = obj(response);
  const wrong: MarkResult = { status: "marked", isCorrect: false, marksAwarded: 0 };
  if (!r) return wrong;

  switch (key.type) {
    case "single_choice": {
      const chosen = typeof r.option_id === "string" ? r.option_id : null;
      const ok = chosen !== null && chosen === key.key.option_ids[0];
      return { status: "marked", isCorrect: ok, marksAwarded: ok ? marks : 0 };
    }
    case "multi_select": {
      const chosen = new Set(strings(r.option_ids) ?? []);
      const correct = new Set(key.key.option_ids);
      if (!partialCredit) {
        const ok = chosen.size === correct.size && [...correct].every((id) => chosen.has(id));
        return { status: "marked", isCorrect: ok, marksAwarded: ok ? marks : 0 };
      }
      // Per option: a correct tick earns, a wrong tick costs, floor at zero.
      let hits = 0;
      let misses = 0;
      for (const id of chosen) {
        if (correct.has(id)) hits += 1;
        else misses += 1;
      }
      const fraction = Math.max(0, hits - misses) / correct.size;
      const awarded = round2(marks * fraction);
      return { status: "marked", isCorrect: fraction === 1, marksAwarded: awarded };
    }
    case "numeric": {
      const value = parseNumber(r.value);
      if (value === null) return wrong;
      const ok = Math.abs(value - key.key.value) <= key.key.tolerance + 1e-9;
      return { status: "marked", isCorrect: ok, marksAwarded: ok ? marks : 0 };
    }
    case "short_text": {
      const text = typeof r.text === "string" ? normaliseText(r.text) : "";
      if (!text) return wrong;
      const ok = key.key.accepted.some((a) => normaliseText(a) === text);
      return { status: "marked", isCorrect: ok, marksAwarded: ok ? marks : 0 };
    }
    case "matching": {
      const given = new Map<string, string>();
      if (Array.isArray(r.pairs)) {
        for (const p of r.pairs) {
          if (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string") given.set(p[0], p[1]);
        }
      }
      const total = key.key.pairs.length;
      const hits = key.key.pairs.filter(([l, rgt]) => given.get(l) === rgt).length;
      if (!partialCredit) {
        const ok = hits === total;
        return { status: "marked", isCorrect: ok, marksAwarded: ok ? marks : 0 };
      }
      return { status: "marked", isCorrect: hits === total, marksAwarded: round2((marks * hits) / total) };
    }
    case "ordering": {
      const given = strings(r.order) ?? [];
      const correct = key.key.order;
      const hits = correct.filter((id, i) => given[i] === id).length;
      const ok = hits === correct.length && given.length === correct.length;
      if (!partialCredit) return { status: "marked", isCorrect: ok, marksAwarded: ok ? marks : 0 };
      return { status: "marked", isCorrect: ok, marksAwarded: round2((marks * hits) / correct.length) };
    }
  }
}
