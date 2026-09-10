/**
 * The arithmetic behind the booking calendar, kept out of the component so
 * the awkward months can be tested: a February in a leap year, a month that
 * begins on a Sunday, a December that has to roll into January.
 *
 * Dates are "YYYY-MM-DD" strings in the school's own day, never Date objects
 * — the sessions are grouped by Gaborone day upstream, and re-parsing them
 * into local time is how a Monday sitting shows up on the Sunday square.
 */

/** Which weekday a date falls on, 0 = Monday, matching the grid's columns. */
export function weekdayIndex(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** Days in a month, 1-based month. Leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-09" for a "2026-09-14". */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * The months these dates fall in, in the order they first appear. The
 * calendar's arrows walk this, so a parent cannot page into a month the
 * school has published nothing in.
 */
export function monthsOf(dates: readonly string[]): string[] {
  const seen: string[] = [];
  for (const date of dates) {
    const key = monthKey(date);
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/**
 * One month as 7-column grid cells: nulls for the days before the first,
 * then every date in the month as "YYYY-MM-DD". Trailing blanks are left to
 * the layout — an empty final row would only add height.
 */
export function monthGrid(key: string): Array<string | null> {
  const [year, month] = key.split("-").map(Number);
  const lead = weekdayIndex(year, month, 1);
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from(
      { length: daysInMonth(year, month) },
      (_, i) => `${key}-${String(i + 1).padStart(2, "0")}`
    ),
  ];
}

/** The day of the month, for the number printed in the square. */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}
