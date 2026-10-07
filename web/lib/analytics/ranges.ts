import { toSchoolDateString } from "@/lib/format-date";

/**
 * The ready-made date ranges above the analytics filter.
 *
 * Staff asked for "past week", "past month" and so on rather than typing two
 * dates every time. Each one is a plain window ending today, counted in days
 * back from today in the school's timezone, so "past week" is today and the
 * seven days before it — the same arithmetic the page already used for its
 * ninety-day default, just named.
 */
export type RangePreset = {
  key: string;
  label: string;
  /** Days back from today. The window is inclusive of both ends. */
  days: number;
};

export const RANGE_PRESETS: readonly RangePreset[] = [
  { key: "7d", label: "Past week", days: 7 },
  { key: "30d", label: "Past month", days: 30 },
  { key: "90d", label: "Past 3 months", days: 90 },
  { key: "180d", label: "Past 6 months", days: 180 },
  { key: "365d", label: "Past year", days: 365 },
];

/** The default the page falls back to when the URL carries no dates. */
export const DEFAULT_PRESET = "90d";

export function rangeFor(preset: RangePreset, today: Date): { from: string; to: string } {
  return {
    from: toSchoolDateString(new Date(today.getTime() - preset.days * 86_400_000)),
    to: toSchoolDateString(today),
  };
}

/**
 * Which preset, if any, the dates currently in the URL match — so the chosen
 * one can be shown as chosen, and a hand-typed range as neither.
 */
export function activePreset(from: string, to: string, today: Date): string | null {
  for (const p of RANGE_PRESETS) {
    const r = rangeFor(p, today);
    if (r.from === from && r.to === to) return p.key;
  }
  return null;
}
