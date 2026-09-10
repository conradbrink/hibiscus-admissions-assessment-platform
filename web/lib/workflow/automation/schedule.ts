/**
 * The weekday session schedule, as arithmetic on dates. Pure and unit
 * tested; `sessions.ts` does the reading and writing.
 *
 * Dates are "YYYY-MM-DD" in school time (Africa/Gaborone, UTC+2, no
 * daylight saving), which is how staff think about a school day.
 */

export type Closure = { campus_id: string | null; starts_on: string; ends_on: string };

const DAY_MS = 86_400_000;

/** The Gaborone calendar date of an instant. */
export function schoolDate(now: Date): string {
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday to Friday, strictly after `from`, up to and including `weeksAhead` weeks later. */
export function weekdaysAhead(from: string, weeksAhead: number): string[] {
  const out: string[] = [];
  const last = weeksAhead * 7;
  for (let i = 1; i <= last; i += 1) {
    const d = addDays(from, i);
    const dow = new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(d);
  }
  return out;
}

/** Whether a campus is closed on a date: a school-wide closure or one for that campus. */
export function isClosed(date: string, campusId: string, closures: Closure[]): boolean {
  return closures.some((c) => (c.campus_id === null || c.campus_id === campusId) && c.starts_on <= date && date <= c.ends_on);
}

/** An instant for a school-time clock reading on a date. */
export function schoolInstant(date: string, minutesAfterMidnight: number): Date {
  const hh = String(Math.floor(minutesAfterMidnight / 60)).padStart(2, "0");
  const mm = String(minutesAfterMidnight % 60).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00+02:00`);
}

export type ScheduleRule = { kind: "assessment" | "visit"; startMinutes: number; durationMinutes: number };

export type PlannedSession = {
  campus_id: string;
  kind: "assessment" | "visit";
  date: string;
  starts_at: string;
  ends_at: string;
};

/** The school-time clock reading of an instant, in minutes after midnight. */
export function schoolMinutes(now: Date): number {
  const local = new Date(now.getTime() + 2 * 3_600_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * The sessions that should exist and do not yet: one per rule per open
 * weekday per campus, skipping any *time* that already has a session of that
 * kind at that campus, whoever created it.
 *
 * The skip used to be per day rather than per time, which meant a campus
 * could only ever have one sitting of each kind a day: the first rule claimed
 * the day and every later rule for that kind was silently dropped. With three
 * sittings a day that is the whole feature, so the key carries the clock
 * reading now. The consequence worth knowing: a session made by hand at 08:00
 * still suppresses the generated 08:00 one, but a session made by hand at any
 * other time no longer suppresses anything.
 */
export function planSessions(opts: {
  today: string;
  weeksAhead: number;
  campusIds: string[];
  closures: Closure[];
  rules: ScheduleRule[];
  existing: Array<{ campus_id: string; kind: string; starts_at: string }>;
}): PlannedSession[] {
  const key = (campusId: string, kind: string, date: string, startMinutes: number) =>
    `${campusId}:${kind}:${date}:${startMinutes}`;
  const taken = new Set(
    opts.existing.map((e) => {
      const at = new Date(e.starts_at);
      return key(e.campus_id, e.kind, schoolDate(at), schoolMinutes(at));
    })
  );
  const days = weekdaysAhead(opts.today, opts.weeksAhead);
  const out: PlannedSession[] = [];
  for (const campusId of opts.campusIds) {
    for (const date of days) {
      if (isClosed(date, campusId, opts.closures)) continue;
      for (const rule of opts.rules) {
        if (taken.has(key(campusId, rule.kind, date, rule.startMinutes))) continue;
        const start = schoolInstant(date, rule.startMinutes);
        out.push({
          campus_id: campusId,
          kind: rule.kind,
          date,
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + rule.durationMinutes * 60_000).toISOString(),
        });
      }
    }
  }
  return out;
}
