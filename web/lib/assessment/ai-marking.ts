import type { RubricBand } from "@/lib/supabase/types";

/**
 * The parts of automatic marking that need no model: which band a blank or
 * token answer earns, and what marks a chosen band is worth. Pure; tested.
 */

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
 * What to record without asking the model: a blank answer earns the lowest
 * band. Anything written at all, however short ("6 1/2" can be a full
 * answer), needs a reading.
 */
export function markWithoutModel(text: unknown, bands: RubricBand[]): { band: string; rationale: string } | null {
  const t = typeof text === "string" ? text.trim() : "";
  if (t.length > 0) return null;
  return { band: lowestBand(bands).key, rationale: "No answer was written." };
}
