/**
 * What to call the appointment.
 *
 * Four words for three stored facts, which is exactly the sort of rule that
 * rots when each screen writes its own ternary:
 *
 * | Condition                       | Word       |
 * | ------------------------------- | ---------- |
 * | the child holds a scholarship   | interview  |
 * | the child sits no assessment    | play date  |
 * | the booking is a look around    | visit      |
 * | otherwise                       | assessment |
 *
 * The middle rows are the ones that catch people out. A *primary* family can
 * come through `/join/visit` to see the campus before applying, so "not an
 * assessment" does not mean "pre-school". Pre-school sits above that
 * precisely because a pre-school booking is stored with `kind = 'visit'` too,
 * and what those families come to is a play date.
 *
 * Scholarship sits above *both*, and it has to. A scholarship child sits no
 * assessment either — that is the whole point of the award — so without this
 * row a Form 3 student would be invited to a play date. "Not assessed" has
 * meant "pre-school" since the day this file was written, and a scholarship
 * intake is the first thing to break that inference.
 *
 * Pure, and used by every surface — emails, WhatsApp, the booking pages, the
 * confirmation card, and the staff console — so the school can say "play date"
 * everywhere by changing one string.
 */

export type BookingNoun = "assessment" | "visit" | "play date" | "interview";

export type BookingNounInput = {
  /** `applications.requires_assessment` — false for the pre-school track. */
  requiresAssessment: boolean;
  /**
   * `bookings.kind`, or null before anything is booked. Null falls back to
   * what this child would be offered, so the nudge to book reads properly.
   */
  bookingKind?: "assessment" | "visit" | null;
  /**
   * Whether the application carries a scholarship award.
   *
   * Required, and it has to be. It was optional first, so that the call sites
   * predating scholarships would keep compiling — and every one of them then
   * kept its old answer, which is to say a Form 3 scholarship student was
   * invited to a play date on every screen and in every email. Nothing caught
   * it: the code compiled and the tests passed their own argument.
   *
   * Required makes the compiler ask the question at all fourteen call sites,
   * which is the only reason anybody answers it.
   */
  scholarship: boolean;
};

export function bookingNoun({ requiresAssessment, bookingKind, scholarship }: BookingNounInput): BookingNoun {
  if (scholarship) return "interview";
  if (!requiresAssessment) return "play date";
  if (bookingKind === "visit") return "visit";
  return "assessment";
}

/** The same word starting a sentence, a heading or a badge. */
export function bookingNounTitle(input: BookingNounInput): string {
  const noun = bookingNoun(input);
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/** More than one of them: for counts and board headings. */
export function bookingNounPlural(input: BookingNounInput): string {
  return `${bookingNoun(input)}s`;
}

/**
 * The template confirming a booking that is not an assessment.
 *
 * Each track gets its own key rather than one reworded template, because each
 * is separately approved with the provider and changing the words of a live
 * one sends it back to Meta for approval.
 *
 * A scholarship interview needs the third key, and this is the one place
 * where knowing about the award but having nowhere to put it is *worse* than
 * not knowing. Without `interview_confirmed`, "play date" sends a Form 3
 * family "there is nothing to bring and a teacher will take you both
 * through", and "visit" sends them "we look forward to showing you the
 * school" — a campus tour, when they are coming to be interviewed.
 */
export function bookingConfirmedTemplateKey(input: BookingNounInput): "playdate_confirmed" | "visit_confirmed" | "interview_confirmed" {
  const noun = bookingNoun(input);
  if (noun === "interview") return "interview_confirmed";
  return noun === "play date" ? "playdate_confirmed" : "visit_confirmed";
}

/**
 * The template saying a booking has *moved*, rather than been made.
 *
 * A reschedule used to send the confirmation again. The parent then held two
 * messages a minute apart, both reading like a fresh booking, with different
 * times and nothing to say which one stood — and at least one family answered
 * that by cancelling. "Your play date has moved to …" is one sentence and
 * removes the ambiguity entirely.
 *
 * Split the same way as `bookingConfirmedTemplateKey`, and for the same
 * reason: pre-school and primary are separately approved with the provider, so
 * one reworded template cannot serve both doors.
 */
export function bookingMovedTemplateKey(input: BookingNounInput): "playdate_moved" | "visit_moved" | "interview_moved" {
  const noun = bookingNoun(input);
  if (noun === "interview") return "interview_moved";
  return noun === "play date" ? "playdate_moved" : "visit_moved";
}
