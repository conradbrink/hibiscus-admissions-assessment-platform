import type { IntakeCadence } from "@/lib/supabase/types";

/**
 * When a child starts, at a campus that runs by the month.
 *
 * Potch CBD, Potch South and Bana Tlokweng do not take children in by the
 * term. A family joins in a month, is invoiced by the month, and reads
 * "October 2026" on the offer letter rather than "Term 3, 2026". The term
 * is still recorded underneath (`applications.intake_id`), because capacity,
 * the academic year the fees belong to and every report are counted by
 * term; `intakeForMonth` is how the month picks it.
 *
 * Pure, so vitest covers it. Dates are ISO days and months are the first of
 * the month (`2026-10-01`), which compare correctly as strings.
 */

export type { IntakeCadence };

export type MonthChoice = { value: string; label: string };

const MONTH_START = /^(\d{4})-(\d{2})-01$/;

/** `2026-10-01` is a month; `2026-10-15` and `2026-13-01` are not. */
export function isMonthStart(value: string): boolean {
  const m = MONTH_START.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 2026", from the first of the month. */
export function formatMonth(month: string): string {
  const m = MONTH_START.exec(month);
  if (!m) return month;
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : month;
}

/** The first of the month `n` months after the month `today` falls in. */
function monthAfter(today: string, n: number): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 + n;
  const y = year + Math.floor(month / 12);
  const m = (month % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * The months a family may choose: this one and the next eleven. The running
 * month stays on the list for the same reason the running term does — a
 * child can start next Monday.
 */
export function monthChoices(today: string, count = 12): MonthChoice[] {
  const out: MonthChoice[] = [];
  for (let i = 0; i < count; i++) {
    const value = monthAfter(today, i);
    out.push({ value, label: formatMonth(value) });
  }
  return out;
}

/**
 * The term a month belongs to: the latest offerable term that has begun by
 * the end of that month, or the first one ahead when none has. October 2026
 * is Term 3, 2026; January 2027 is Term 1, 2027 (which starts on the 11th,
 * still inside January); December 2026 stays Term 3, 2026.
 *
 * Null when nothing is offerable at all, and null when the month falls
 * outside the academic year of the term it would otherwise be filed under.
 * That second case is what stops a family choosing, say, August 2027 while
 * only Term 3 2026 is open and having the child counted — and priced — in
 * the 2026 fee year. Callers that pass `year_ends_on` get that guard;
 * a caller with no year to hand keeps the older behaviour.
 */
export function intakeForMonth<T extends { starts_on: string; year_ends_on?: string | null }>(
  intakes: readonly T[],
  month: string
): T | null {
  const sorted = [...intakes].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const endOfMonth = `${month.slice(0, 7)}-31`;
  const begun = sorted.filter((i) => i.starts_on <= endOfMonth);
  const chosen = begun.at(-1) ?? sorted[0] ?? null;
  if (!chosen) return null;
  // The month must fall inside that term's academic year. A month before the
  // first open term is fine — the family is booking ahead into the year that
  // term belongs to — so only the far end is refused.
  if (chosen.year_ends_on && month > chosen.year_ends_on) return null;
  return chosen;
}

/** What a page or letter calls the start: the month where one was chosen, the term otherwise. */
export function startLabel(application: { start_month: string | null }, intake: { label: string }): string {
  return application.start_month ? formatMonth(application.start_month) : intake.label;
}

/**
 * The first school day of a month: the 1st, or the Monday after it when the
 * 1st falls on a weekend.
 *
 * The month is what the family chose and what the letter names; this is the
 * day the child actually walks in, and it is what the first-day email, the
 * enrolment record and the export all carry. "Your child's first day is
 * Sunday 1 November" is the sentence this exists to stop.
 */
export function firstSchoolDay(month: string): string {
  // Parsed as UTC noon so the weekday is the calendar one everywhere.
  const d = new Date(`${month}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  const shift = d.getUTCDay() === 0 ? 1 : d.getUTCDay() === 6 ? 2 : 0;
  if (shift === 0) return month;
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

/**
 * The day the child starts: the first school day of the chosen month, or the
 * term's first day. The school sets term dates on weekdays already, so the
 * rolling only ever applies to a month.
 */
export function startsOn(application: { start_month: string | null }, intake: { starts_on: string }): string {
  return application.start_month ? firstSchoolDay(application.start_month) : intake.starts_on;
}
