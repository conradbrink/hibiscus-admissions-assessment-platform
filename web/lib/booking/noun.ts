/**
 * What to call the appointment.
 *
 * Three words for three stored facts, which is exactly the sort of rule that
 * rots when each screen writes its own ternary:
 *
 * | Condition                       | Word       |
 * | ------------------------------- | ---------- |
 * | the child holds a scholarship   | interview  |
 * | the child sits no assessment    | visit      |
 * | the booking is a look around    | visit      |
 * | otherwise                       | assessment |
 *
 * The pre-school track used to have a fourth word, "play date", and the two
 * middle rows were one row apart for that reason: a pre-school booking and a
 * primary look-around are both stored with `kind = 'visit'`, and only
 * `requires_assessment` told them apart. The school decided the pre-school
 * families should be invited to see the school on the same terms as everybody
 * else, so the two rows now give the same answer and the word is gone.
 *
 * What that leaves behind is worth knowing, because the rows still differ in
 * one way the table cannot show: a pre-school family's noun does not depend on
 * `bookingKind` at all. They read "visit" before anything is booked, which is
 * what the nudge to book needs, and a primary family reads "assessment" until
 * a visit is actually on the books.
 *
 * Scholarship sits above both, and it has to. A scholarship child sits no
 * assessment either — that is the whole point of the award — so without that
 * first row a Form 3 student would be invited to a campus tour.
 *
 * Pure, and used by every surface — emails, WhatsApp, the booking pages, the
 * confirmation card, and the staff console — so the school can change what it
 * calls an appointment by changing one string.
 */

export type BookingNoun = "assessment" | "visit" | "interview";

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
   * Required makes the compiler ask the question at every call site, which is
   * the only reason anybody answers it.
   */
  scholarship: boolean;
};

export function bookingNoun({ requiresAssessment, bookingKind, scholarship }: BookingNounInput): BookingNoun {
  if (scholarship) return "interview";
  if (!requiresAssessment || bookingKind === "visit") return "visit";
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
 * That approval rule is why dropping "play date" cost nothing to send: the
 * pre-school track now routes to `visit_confirmed`, which was already live and
 * approved for the primary families looking around. The `playdate_confirmed`
 * and `playdate_moved` templates are left in place but unreferenced — a
 * template nobody sends is harmless, and deleting an approved one to save a
 * row would mean a fresh submission if the school ever wants the warmer
 * pre-school wording back.
 *
 * A scholarship interview needs the third key, and this is the one place where
 * knowing about the award but having nowhere to put it is *worse* than not
 * knowing: without `interview_confirmed`, a Form 3 family reads "we look
 * forward to showing you the school" — a campus tour, when they are coming to
 * be interviewed.
 */
export function bookingConfirmedTemplateKey(input: BookingNounInput): "visit_confirmed" | "interview_confirmed" {
  return bookingNoun(input) === "interview" ? "interview_confirmed" : "visit_confirmed";
}

/**
 * The template saying a booking has *moved*, rather than been made.
 *
 * A reschedule used to send the confirmation again. The parent then held two
 * messages a minute apart, both reading like a fresh booking, with different
 * times and nothing to say which one stood — and at least one family answered
 * that by cancelling. "Your visit has moved to …" is one sentence and removes
 * the ambiguity entirely.
 */
export function bookingMovedTemplateKey(input: BookingNounInput): "visit_moved" | "interview_moved" {
  return bookingNoun(input) === "interview" ? "interview_moved" : "visit_moved";
}
