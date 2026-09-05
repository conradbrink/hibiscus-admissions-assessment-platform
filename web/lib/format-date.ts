/**
 * Date and time formatting, in the school's own timezone.
 *
 * Every campus is in Botswana or South Africa, both UTC+2 with no daylight
 * saving, so one fixed zone is correct today. It is a constant rather than a
 * per-campus setting because nothing yet needs the second value, and a setting
 * nobody can exercise is a setting nobody notices is wrong.
 */
export const SCHOOL_TIMEZONE = "Africa/Gaborone";

const DATE_LONG = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: SCHOOL_TIMEZONE,
});

const DATE_SHORT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: SCHOOL_TIMEZONE,
});

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: SCHOOL_TIMEZONE,
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: SCHOOL_TIMEZONE,
});

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  // A date-only string is parsed by ECMAScript as UTC midnight, which renders
  // as the previous day anywhere behind UTC. Botswana is ahead, so today it
  // would be fine — but pinning local parsing costs nothing and stops a
  // reader in another zone seeing a birthday a day early.
  const s =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00`
      : value;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Saturday 12 September 2026" */
export function formatDateLong(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? DATE_LONG.format(d) : "—";
}

/** "12 Sep 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? DATE_SHORT.format(d) : "—";
}

/** "09:00" */
export function formatTime(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? TIME.format(d) : "—";
}

/** "12 Sep 2026, 09:00" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? DATE_TIME.format(d) : "—";
}

/** True once an instant is in the past. Lives here so components stay pure. */
export function hasStarted(value: string | Date): boolean {
  const d = parse(value);
  return d !== null && d.getTime() < Date.now();
}

/** `YYYY-MM-DD` for N days ago, in the school's zone. */
export function daysAgoDateString(days: number): string {
  return toSchoolDateString(new Date(Date.now() - days * 86_400_000));
}

/** A date-only `YYYY-MM-DD` for the school's zone, from any instant. */
export function toSchoolDateString(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: SCHOOL_TIMEZONE,
  }).formatToParts(value);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
