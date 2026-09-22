import { describe, expect, it } from "vitest";
import { bookingConfirmedTemplateKey, bookingMovedTemplateKey, bookingNoun, bookingNounPlural, bookingNounTitle } from "./noun";

describe("bookingNoun", () => {
  it("calls a pre-school booking a play date", () => {
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("play date");
  });

  it("calls a primary family's look around a visit", () => {
    // The case the two-valued rule got wrong: a Form 2 family can come
    // through /join/visit, and what they booked is a visit, not a play date.
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit");
  });

  it("calls an assessment an assessment", () => {
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("assessment");
  });

  it("falls back to what the child would be offered when nothing is booked", () => {
    // The rebooking nudge is sent precisely when there is no booking left.
    expect(bookingNoun({ requiresAssessment: true, bookingKind: null, scholarship: false })).toBe("assessment");
    expect(bookingNoun({ requiresAssessment: false, bookingKind: null, scholarship: false })).toBe("play date");
    expect(bookingNoun({ requiresAssessment: false, scholarship: false })).toBe("play date");
  });

  it("never calls a pre-school booking an assessment, whatever the row says", () => {
    // Belt and braces: a pre-school booking stored as an assessment is a bug
    // upstream, and the parent should still not read the word.
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "assessment", scholarship: false })).toBe("play date");
  });
});

describe("the same word in other places", () => {
  it("capitalises for a heading", () => {
    expect(bookingNounTitle({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("Play date");
    expect(bookingNounTitle({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("Visit");
    expect(bookingNounTitle({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("Assessment");
  });

  it("pluralises for a count", () => {
    expect(bookingNounPlural({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("play dates");
    expect(bookingNounPlural({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("assessments");
  });
});

describe("bookingConfirmedTemplateKey", () => {
  it("sends pre-school its own confirmation", () => {
    expect(bookingConfirmedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("playdate_confirmed");
  });

  it("leaves the approved visit template alone for everybody else", () => {
    expect(bookingConfirmedTemplateKey({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit_confirmed");
  });
});

describe("bookingMovedTemplateKey", () => {
  it("splits the same way the confirmation does", () => {
    expect(bookingMovedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("playdate_moved");
    expect(bookingMovedTemplateKey({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit_moved");
  });

  it("is never the confirmation", () => {
    // The bug this replaces: a reschedule sent the confirmation again, so the
    // parent held two messages a minute apart with different times and no way
    // to tell which stood. Whatever else changes, these two must not converge.
    for (const input of [
      { requiresAssessment: false, bookingKind: "visit" as const, scholarship: false },
      { requiresAssessment: true, bookingKind: "visit" as const, scholarship: false },
    ]) {
      expect(bookingMovedTemplateKey(input)).not.toBe(bookingConfirmedTemplateKey(input));
    }
  });
});

describe("a scholarship child is interviewed", () => {
  // The whole reason this case exists: a scholarship child sits no
  // assessment, which until now meant pre-school and therefore "play date".
  // Inviting a Form 3 student to a play date is the bug being prevented.
  it("says interview, not play date, though no assessment is sat", () => {
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "visit", scholarship: true })).toBe("interview");
  });

  it("says interview whatever the booking says, and before anything is booked", () => {
    expect(bookingNoun({ requiresAssessment: false, bookingKind: null, scholarship: true })).toBe("interview");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "visit", scholarship: true })).toBe("interview");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "assessment", scholarship: true })).toBe("interview");
  });

  it("leaves every other family exactly as they were", () => {
    // `scholarship` is optional and false-y for the dozens of call sites that
    // predate it; none of them may change answer.
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("play date");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit");
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "assessment", scholarship: false })).toBe("assessment");
  });

  it("reads properly in a heading and a count", () => {
    expect(bookingNounTitle({ requiresAssessment: false, scholarship: true })).toBe("Interview");
    expect(bookingNounPlural({ requiresAssessment: false, scholarship: true })).toBe("interviews");
  });

  it("confirms and reschedules on its own templates, not the pre-school or visit ones", () => {
    // This assertion used to read `visit_confirmed`, on the reasoning that its
    // wording suited an interview and a new pair would say nothing different.
    // Reading the template disproved it: `visit_confirmed` promises "we look
    // forward to showing you the school", which is a campus tour, and
    // `playdate_confirmed` — where a scholarship child landed before the word
    // existed — promises "nothing to prepare and nothing to bring" and a
    // teacher who "will take you both through", to the parent of a Form 3
    // student. Neither is what anybody is coming for.
    expect(bookingConfirmedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: true })).toBe("interview_confirmed");
    expect(bookingMovedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: true })).toBe("interview_moved");
    // And the two tracks it must not disturb.
    expect(bookingConfirmedTemplateKey({ requiresAssessment: false, bookingKind: "visit", scholarship: false })).toBe("playdate_confirmed");
    expect(bookingConfirmedTemplateKey({ requiresAssessment: true, bookingKind: "visit", scholarship: false })).toBe("visit_confirmed");
  });
});
