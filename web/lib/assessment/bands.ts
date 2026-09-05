import { z } from "zod";
import type { BenchmarkBand, Json, RubricBand } from "@/lib/supabase/types";

/**
 * Rubric bands (how a piece of writing is marked) and benchmark bands (how a
 * percentage becomes a word on the learning profile). Both are JSON columns
 * edited by staff, so both are validated on the way in and parsed
 * defensively on the way out.
 */

export const RUBRIC_BAND_SCHEMA = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().trim().min(1).max(60),
  min_marks: z.number().min(0),
  descriptor: z.string().trim().min(1).max(1000),
});

export const RUBRIC_BANDS_SCHEMA = z.array(RUBRIC_BAND_SCHEMA).min(2);

export function parseRubricBands(json: Json | null | undefined): RubricBand[] {
  const result = RUBRIC_BANDS_SCHEMA.safeParse(json);
  if (!result.success) return [];
  return [...result.data].sort((a, b) => a.min_marks - b.min_marks);
}

export const BENCHMARK_BAND_KEYS: BenchmarkBand[] = ["below", "approaching", "meeting", "exceeding"];

export const BENCHMARK_BANDS_SCHEMA = z
  .array(z.object({ key: z.enum(BENCHMARK_BAND_KEYS), min_percent: z.number().min(0).max(100) }))
  .min(2)
  .refine((bands) => bands.some((b) => b.min_percent === 0), "One band must start at 0")
  .refine((bands) => new Set(bands.map((b) => b.key)).size === bands.length, "Each band once");

export type BenchmarkBands = z.infer<typeof BENCHMARK_BANDS_SCHEMA>;

export const DEFAULT_BENCHMARK_BANDS: BenchmarkBands = [
  { key: "below", min_percent: 0 },
  { key: "approaching", min_percent: 40 },
  { key: "meeting", min_percent: 60 },
  { key: "exceeding", min_percent: 80 },
];

export function parseBenchmarkBands(json: Json | null | undefined): BenchmarkBands {
  const result = BENCHMARK_BANDS_SCHEMA.safeParse(json);
  return result.success ? result.data : DEFAULT_BENCHMARK_BANDS;
}

/** The band a percentage falls in: the highest band whose floor it reaches. */
export function bandFor(percent: number, bands: BenchmarkBands): BenchmarkBand {
  const sorted = [...bands].sort((a, b) => a.min_percent - b.min_percent);
  let current: BenchmarkBand = sorted[0]?.key ?? "below";
  for (const b of sorted) {
    if (percent >= b.min_percent) current = b.key;
  }
  return current;
}

export const BAND_LABELS: Record<BenchmarkBand, string> = {
  below: "Below expectations",
  approaching: "Approaching",
  meeting: "Meeting expectations",
  exceeding: "Exceeding",
};
