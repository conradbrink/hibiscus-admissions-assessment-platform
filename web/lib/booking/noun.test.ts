import { describe, expect, it } from "vitest";
import { bookingConfirmedTemplateKey, bookingMovedTemplateKey, bookingNoun, bookingNounPlural, bookingNounTitle } from "./noun";

describe("bookingNoun", () => {
  it("calls a pre-school booking a visit", () => {
    // It was "play date" until the school decided the pre-school families
    // should be invited on the same terms as everybody else.
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("visit");
  });

  it("calls a primary family's look around a visit too", () => {
    // A Form 2 family can come through /join/visit. Both doors now give the
    // same word, which is the point of the change, so this is the test that
    // would catch a half-done revert leaving one door saying something else.
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit");
  });

  it("calls an assessment an assessment", () => {
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("assessment");
  });

  it("falls back to what the child would be offered when nothing is booked", () => {
    // The rebooking nudge is sent precisely when there is no booking left.
    expect(bookingNoun({ requiresAssessment: true, bookingKind: null, scholarship: false })).toBe("assessment");
    expect(bookingNoun({ requiresAssessment: false, bookingKind: null, scholarship: false })).toBe("visit");
    expect(bookingNoun({ requiresAssessment: false, scholarship: false })).toBe("visit");
  });

  it("never calls a pre-school booking an assessment, whatever the row says", () => {
    // Belt and braces: a pre-school booking stored as an assessment is a bug
    // upstream, and the parent should still not read the word.
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "assessment", scholarship: false })).toBe("visit");
  });
});

describe("the same word in other places", () => {
  it("capitalises for a heading", () => {
    expect(bookingNounTitle({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("Visit");
    expect(bookingNounTitle({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("Assessment");
  });

  it("pluralises for a count", () => {
    expect(bookingNounPlural({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("visits");
    expect(bookingNounPlural({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("assessments");
  });
});

describe("bookingConfirmedTemplateKey", () => {
  it("sends both look-around tracks the approved visit confirmation", () => {
    // Pre-school used to have `playdate_confirmed`. Routing it here is what
    // made dropping the word free to ship: `visit_confirmed` was already live
    // and approved, so nothing went back to Meta.
    expect(bookingConfirmedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("visit_confirmed");
    expect(bookingConfirmedTemplateKey({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit_confirmed");
  });
});

describe("bookingMovedTemplateKey", () => {
  it("splits the same way the confirmation does", () => {
    expect(bookingMovedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("visit_moved");
    expect(bookingMovedTemplateKey({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit_moved");
  });

  it("is never the confirmation", () => {
    // The bug this replaces: a reschedule sent the confirmation again, so the
    // parent held two messages a minute apart with different times and no way
    // to tell which stood. Whatever else changes, these two must not converge.
    for (const input of [
      { requiresAssessment: false, bookingKind: "visit" as const, scholarship: false },
      { requiresAssessment: true, bookingKind: "visit" as const, scholarship: false },
      { requiresAssessment: false, bookingKind: "visit" as const, scholarship: true },
    ]) {
      expect(bookingMovedTemplateKey(input)).not.toBe(bookingConfirmedTemplateKey(input));
    }
  });
});

describe("a scholarship child is interviewed", () => {
  // The whole reason this case exists: a scholarship child sits no assessment,
  // which once meant pre-school and therefore "play date". Now that the
  // pre-school word is "visit", the failure mode is milder but still wrong —
  // a Form 3 student invited to look around the campus — and the row that
  // prevents it is the same one.
  it("says interview, not visit, though no assessment is sat", () => {
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "visit", scholarship: true })).toBe("interview");
  });

  it("says interview whatever the booking says, and before anything is booked", () => {
    expect(bookingNoun({ requiresAssessment: false, bookingKind: null, scholarship: true })).toBe("interview");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "visit", scholarship: true })).toBe("interview");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "assessment", scholarship: true })).toBe("interview");
  });

  it("leaves every other family exactly as they were", () => {
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("visit");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("assessment");
  });

  it("reads properly in a heading and a count", () => {
    expect(bookingNounTitle({ requiresAssessment: false, scholarship: true })).toBe("Interview");
    expect(bookingNounPlural({ requiresAssessment: false, scholarship: true })).toBe("interviews");
  });

  it("confirms and reschedules on its own templates, not the visit ones", () => {
    // This assertion used to read `visit_confirmed`, on the reasoning that its
    // wording suited an interview and a new pair would say nothing different.
    // Reading the template disproved it: `visit_confirmed` promises "we look
    // forward to showing you the school", which is a campus tour, to the
    // parent of a Form 3 student coming to be interviewed. That reasoning now
    // guards a second thing — the pre-school track landed on that same visit
    // template, so an interview must not be allowed to follow it there.
    expect(bookingConfirmedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: true })).toBe("interview_confirmed");
    expect(bookingMovedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: true })).toBe("interview_moved");
  });
});
