import type { RubricBand } from "@/lib/supabase/types";

/**
 * The parts of automatic marking that need no model: which band a blank or
 * token answer earns, and what marks a chosen band is worth. Pure; tested.
 */

/** Fewer characters than this is not an attempt at the question. */
export const MIN_ANSWER_CHARS = 10;

export function lowestBand(bands: RubricBand[]): RubricBand {
  return [...bands].sort((a, b) => a.min_marks - b.min_marks)[0];
}

/** The mark for a band, never above the question's marks. */
export function marksForBand(bands: RubricBand[], key: string, maxMarks: number): number | null {
  const band = bands.find((b) => b.key === key);
  if (!band) return null;
  return Math.min(maxMarks, Math.max(0, Math.round(band.min_marks * 100) / 100));
}

/**
 * What to record without asking the model: a blank or token answer earns
 * the lowest band. Anything else needs a reading.
 */
export function markWithoutModel(text: unknown, bands: RubricBand[]): { band: string; rationale: string } | null {
  const t = typeof text === "string" ? text.trim() : "";
  if (t.length >= MIN_ANSWER_CHARS) return null;
  const band = lowestBand(bands);
  return { band: band.key, rationale: t.length === 0 ? "No answer was written." : "Too little was written to be an answer." };
}
