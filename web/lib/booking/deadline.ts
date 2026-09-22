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
