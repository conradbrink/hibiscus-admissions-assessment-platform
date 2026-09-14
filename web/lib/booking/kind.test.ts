import { describe, expect, it } from "vitest";
import { nextBookingKind } from "./kind";

describe("nextBookingKind", () => {
  it("offers a sitting straight away through the assessment door", () => {
    expect(nextBookingKind({ requiresAssessment: true, entryRoute: "assessment", visitAttended: false })).toBe("assessment");
  });
  it("offers a look-around first through the visit door, whatever next_action says", () => {
    expect(nextBookingKind({ requiresAssessment: true, entryRoute: "visit", visitAttended: false })).toBe("visit");
  });
  it("offers the sitting once the visit has been attended", () => {
    expect(nextBookingKind({ requiresAssessment: true, entryRoute: "visit", visitAttended: true })).toBe("assessment");
  });
  it("never offers a sitting to an exempt grade, through any door", () => {
    for (const entryRoute of ["assessment", "visit", "callback", null]) {
      expect(nextBookingKind({ requiresAssessment: false, entryRoute, visitAttended: true })).toBe("visit");
    }
  });
  it("treats a callback enquiry like the assessment door once routed", () => {
    expect(nextBookingKind({ requiresAssessment: true, entryRoute: "callback", visitAttended: false })).toBe("assessment");
  });
});
