/**
 * The interview deadline, as dates rather than as a database.
 *
 * Pure, and deliberately free of `server-only`: the slot filter that excludes
 * a late session and the page that explains why are two different places, and
 * both have to agree about when a day ends. The 2027 scholarship intake runs
 * to a date the school put to 172 families in writing, so "is this past it"
 * is a question worth having one answer to.
 */

/**
 * The last instant of a day, in the time zone the school and every family are
 * standing in — not midnight UTC, which would quietly cut two hours off the
 * last afternoon.
 */
export function endOfDayIn(day: Date): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Gaborone",
  }).format(day);
  // Gaborone is UTC+2 all year: no daylight saving, so the offset is a
  // constant rather than something to look up.
  return new Date(`${key}T23:59:59.999+02:00`);
}

/**
 * A settings date as a `Date`, or null if it is not one.
 *
 * `new Date("")` is an Invalid Date, not a throw, and it only blows up later
 * inside `endOfDayIn` when something asks it for an ISO string. A setting is a
 * text box a person types into, so the parse belongs here rather than in each
 * caller's head.
 */
export function parseDeadline(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whether a deadline day is already behind us.
 *
 * Inclusive of the day itself, and computed the same way the slot filter
 * computes its cutoff — the two must agree, or the page offers no dates and
 * then refuses to say the window closed, or says it closed while slots are
 * still on offer.
 *
 * The distinction this exists for: "no dates are open right now" and "there
 * will never be another date" are different sentences. A scholarship family
 * whose campus is merely booked out must not be told their interview window
 * closed on a date that has not arrived yet.
 */
export function deadlinePassed(deadline: Date | null, now: Date = new Date()): boolean {
  return deadline !== null && now > endOfDayIn(deadline);
}

/** The first instant of a day in Gaborone, the other end of `endOfDayIn`. */
export function startOfDayIn(day: Date): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Gaborone",
  }).format(day);
  return new Date(`${key}T00:00:00.000+02:00`);
}

/** The days a family may book between, each end inclusive; null is open. */
export type BookingWindow = { notBefore: Date | null; notAfter: Date | null };

/**
 * The window one application books in.
 *
 * An application can carry a window of its own (`interview_window_from` and
 * `_to`), which the late primary scholarship families do: 12 to 23 October.
 * Otherwise a scholarship family runs to the school-wide deadline setting and
 * everybody else is open at both ends — which is exactly what the booking
 * page did before an application could say more.
 */
export function bookingWindow(
  app: { interview_window_from?: string | null; interview_window_to?: string | null },
  opts: { scholarship: boolean; scholarshipDeadline: string | null | undefined }
): BookingWindow {
  return {
    notBefore: parseDeadline(app.interview_window_from),
    notAfter: parseDeadline(app.interview_window_to) ?? (opts.scholarship ? parseDeadline(opts.scholarshipDeadline) : null),
  };
}

/**
 * Whether a session falls inside a window.
 *
 * The same day boundaries as the slot filter, so the page never shows a time
 * the booking then refuses, nor refuses one it showed.
 */
export function withinWindow(startsAt: Date, window: BookingWindow): boolean {
  if (window.notBefore && startsAt < startOfDayIn(window.notBefore)) return false;
  if (window.notAfter && startsAt > endOfDayIn(window.notAfter)) return false;
  return true;
}
