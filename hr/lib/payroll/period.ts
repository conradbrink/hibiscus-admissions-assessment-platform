/**
 * Pay months. A run, a timesheet and a payslip each belong to one month,
 * written `YYYY-MM`. Pure, so the screens, the engine and the exports agree.
 */

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: string): boolean {
  return PERIOD_RE.test(value);
}

/** The first and last day of a month, `YYYY-MM-DD`. */
export function periodBounds(period: string): { start: string; end: string } {
  if (!isPeriod(period)) throw new Error(`Not a pay month: ${period}`);
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, "0")}` };
}

/** "October 2026". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currencyFor(country: "BW" | "ZA"): "BWP" | "ZAR" {
  return country === "BW" ? "BWP" : "ZAR";
}

/** Whether an employee was employed on any day of the month. */
export function employedDuring(e: { start_date: string; end_date: string | null }, period: string): boolean {
  const { start, end } = periodBounds(period);
  return e.start_date <= end && (!e.end_date || e.end_date >= start);
}
