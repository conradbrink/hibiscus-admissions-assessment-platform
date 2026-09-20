/**
 * The dates of a free trial week, as the pre-schools run one: Monday to
 * Friday. Pure, so the review queue can suggest a week and the action can
 * check the one it is given without a database.
 */

const DAY = 86_400_000;

function fromIso(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date ? null : d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Monday after `today` (never today itself): the earliest week a family can be invited to. */
export function nextMonday(today: Date): string {
  const utc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dow = utc.getUTCDay(); // 0 Sunday … 6 Saturday
  const ahead = dow === 0 ? 1 : 8 - dow;
  return toIso(new Date(utc.getTime() + ahead * DAY));
}

/** Four days after the start: a Monday gives Friday. Null for a start that is not a date. */
export function trialWeekEnd(startsOn: string): string | null {
  const d = fromIso(startsOn);
  return d ? toIso(new Date(d.getTime() + 4 * DAY)) : null;
}

export type TrialWeekDates = { startsOn: string; endsOn: string };

/**
 * A start (and optionally an end) as the form gave them, checked: real
 * dates, the end no earlier than the start, the week no longer than a
 * fortnight and not already over.
 */
export function trialWeekDates(startsOn: string, endsOn: string | null | undefined, today: Date): { ok: true; dates: TrialWeekDates } | { ok: false; error: string } {
  const start = fromIso(startsOn);
  if (!start) return { ok: false, error: "Choose the Monday the trial week starts." };
  const end = endsOn ? fromIso(endsOn) : new Date(start.getTime() + 4 * DAY);
  if (!end) return { ok: false, error: "The end of the week is not a date." };
  if (end.getTime() < start.getTime()) return { ok: false, error: "The trial week cannot end before it starts." };
  if (end.getTime() - start.getTime() > 13 * DAY) return { ok: false, error: "A trial week is a week, or two at most." };
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (end.getTime() < todayUtc) return { ok: false, error: "That week has already passed." };
  return { ok: true, dates: { startsOn: toIso(start), endsOn: toIso(end) } };
}

const LONG = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
const YEAR = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });

/** "Mon 12 to Fri 16 October 2026", or across months "Mon 28 September to Fri 2 October 2026". */
export function formatTrialWeek(dates: TrialWeekDates): string {
  const s = fromIso(dates.startsOn);
  const e = fromIso(dates.endsOn);
  if (!s || !e) return `${dates.startsOn} to ${dates.endsOn}`;
  if (s.getTime() === e.getTime()) return `${LONG.format(s)} ${YEAR.format(s)}`;
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  return `${sameMonth ? SHORT.format(s) : LONG.format(s)} to ${LONG.format(e)} ${YEAR.format(e)}`;
}
