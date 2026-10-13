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
 * The years a range may fall in: wide enough for any real intake, narrow
 * enough that a slip of the keyboard (0202) or a 9999 cannot have the page
 * build a hundred thousand weeks, or 14 million on the way to throwing.
 */
const EARLIEST_YEAR = 2000;
const LATEST_YEAR = 2100;

/** Ten years of weeks is the most the page will draw. */
const LONGEST_DAYS = 3653;

/** A real calendar day, YYYY-MM-DD, in the years above: 2026-02-31 is not one. */
export function isCalendarDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const year = Number(s.slice(0, 4));
  if (year < EARLIEST_YEAR || year > LATEST_YEAR) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The range the URL asks for, made safe to read and draw. Either end that is
 * not a real day falls back to the default's; a range given backwards is
 * turned round rather than read as empty; and one longer than ten years falls
 * back to the default altogether. The page and its CSV export both use this,
 * so the file always matches the screen.
 */
export function resolveRange(from: string | null | undefined, to: string | null | undefined, today: Date): { from: string; to: string } {
  const fallback = rangeFor(RANGE_PRESETS.find((p) => p.key === DEFAULT_PRESET)!, today);
  let start = isCalendarDate(from) ? from : fallback.from;
  let end = isCalendarDate(to) ? to : fallback.to;
  if (start > end) [start, end] = [end, start];
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return days > LONGEST_DAYS ? fallback : { from: start, to: end };
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
