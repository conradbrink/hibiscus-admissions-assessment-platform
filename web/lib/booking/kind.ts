/**
 * Which kind of session a family is offered next. The door decides the
 * first booking: the assessment door goes straight to a sitting, the visit
 * door to a look-around. Once the family has come to that visit, the next
 * booking is the sitting. Before this the door decided for ever, so a
 * primary family who had visited was still offered visits and could not
 * book the assessment themselves; and a first attempt at fixing it read
 * `next_action`, which is `book_assessment` from the first day of an
 * assessed enquiry whichever door it came through, so the visit door
 * offered sittings before the family had visited.
 */
export function nextBookingKind(input: { requiresAssessment: boolean; entryRoute: string | null; visitAttended: boolean }): "assessment" | "visit" {
  if (!input.requiresAssessment) return "visit";
  if (input.entryRoute !== "visit") return "assessment";
  return input.visitAttended ? "assessment" : "visit";
}
