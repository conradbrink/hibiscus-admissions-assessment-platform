/**
 * What to call the appointment.
 *
 * Three words for two stored columns, which is exactly the sort of rule that
 * rots when each screen writes its own ternary:
 *
 * | Condition                  | Word        |
 * | -------------------------- | ----------- |
 * | the child sits no assessment | play date |
 * | the booking is a look around | visit     |
 * | otherwise                    | assessment |
 *
 * The middle row is the one that catches people out. A *primary* family can
 * come through `/join/visit` to see the campus before applying, so "not an
 * assessment" does not mean "pre-school". Pre-school comes first precisely
 * because a pre-school booking is stored with `kind = 'visit'` too, and what
 * those families come to is a play date.
 *
 * Pure, and used by every surface — emails, WhatsApp, the booking pages, the
 * confirmation card, and the staff console — so the school can say "play date"
 * everywhere by changing one string.
 */

export type BookingNoun = "assessment" | "visit" | "play date";

export type BookingNounInput = {
  /** `applications.requires_assessment` — false for the pre-school track. */
  requiresAssessment: boolean;
  /**
   * `bookings.kind`, or null before anything is booked. Null falls back to
   * what this child would be offered, so the nudge to book reads properly.
   */
  bookingKind?: "assessment" | "visit" | null;
};

export function bookingNoun({ requiresAssessment, bookingKind }: BookingNounInput): BookingNoun {
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
 * Pre-school gets its own key rather than a reworded `visit_confirmed`,
 * because `visit_confirmed` is approved with Zavu for the primary look-around
 * door and changing its words sends it back for approval.
 */
export function bookingConfirmedTemplateKey(input: BookingNounInput): "playdate_confirmed" | "visit_confirmed" {
  return bookingNoun(input) === "play date" ? "playdate_confirmed" : "visit_confirmed";
}
