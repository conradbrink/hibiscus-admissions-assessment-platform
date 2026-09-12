import { describe, expect, it } from "vitest";
import { bookingConfirmedTemplateKey, bookingNoun, bookingNounPlural, bookingNounTitle } from "./noun";

describe("bookingNoun", () => {
  it("calls a pre-school booking a play date", () => {
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "visit" })).toBe("play date");
  });

  it("calls a primary family's look around a visit", () => {
    // The case the two-valued rule got wrong: a Form 2 family can come
    // through /join/visit, and what they booked is a visit, not a play date.
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "visit" })).toBe("visit");
  });

  it("calls an assessment an assessment", () => {
    expect(bookingNoun({ requiresAssessment: true, bookingKind: "assessment" })).toBe("assessment");
  });

  it("falls back to what the child would be offered when nothing is booked", () => {
    // The rebooking nudge is sent precisely when there is no booking left.
    expect(bookingNoun({ requiresAssessment: true, bookingKind: null })).toBe("assessment");
    expect(bookingNoun({ requiresAssessment: false, bookingKind: null })).toBe("play date");
    expect(bookingNoun({ requiresAssessment: false })).toBe("play date");
  });

  it("never calls a pre-school booking an assessment, whatever the row says", () => {
    // Belt and braces: a pre-school booking stored as an assessment is a bug
    // upstream, and the parent should still not read the word.
    expect(bookingNoun({ requiresAssessment: false, bookingKind: "assessment" })).toBe("play date");
  });
});

describe("the same word in other places", () => {
  it("capitalises for a heading", () => {
    expect(bookingNounTitle({ requiresAssessment: false, bookingKind: "visit" })).toBe("Play date");
    expect(bookingNounTitle({ requiresAssessment: true, bookingKind: "visit" })).toBe("Visit");
    expect(bookingNounTitle({ requiresAssessment: true, bookingKind: "assessment" })).toBe("Assessment");
  });

  it("pluralises for a count", () => {
    expect(bookingNounPlural({ requiresAssessment: false, bookingKind: "visit" })).toBe("play dates");
    expect(bookingNounPlural({ requiresAssessment: true, bookingKind: "assessment" })).toBe("assessments");
  });
});

describe("bookingConfirmedTemplateKey", () => {
  it("sends pre-school its own confirmation", () => {
    expect(bookingConfirmedTemplateKey({ requiresAssessment: false, bookingKind: "visit" })).toBe("playdate_confirmed");
  });

  it("leaves the approved visit template alone for everybody else", () => {
    expect(bookingConfirmedTemplateKey({ requiresAssessment: true, bookingKind: "visit" })).toBe("visit_confirmed");
  });
});
