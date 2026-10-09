import { describe, expect, it } from "vitest";
import { bookingKindsInScope, todaysBoardEmpty, todaysBoardTitle, type OfferedGrade } from "./scope";

const preschool = (campusId: string): OfferedGrade => ({ campusId, requiresAssessment: null, gradeRequiresAssessment: false });
const primary = (campusId: string): OfferedGrade => ({ campusId, requiresAssessment: null, gradeRequiresAssessment: true });

describe("bookingKindsInScope", () => {
  const offered = [preschool("phase2"), primary("block7"), preschool("block7")];

  it("a pre-school campus runs visits and no assessments", () => {
    expect(bookingKindsInScope(offered, ["phase2"])).toEqual({ assessment: false, visit: true });
  });

  it("a campus with both runs both", () => {
    expect(bookingKindsInScope(offered, ["block7"])).toEqual({ assessment: true, visit: true });
  });

  it("somebody scoped to a pre-school and a primary gets one scope covering both", () => {
    // The mixed case the dashboard has to get right: not two dashboards, and
    // not the first campus's answer applied to the second.
    expect(bookingKindsInScope([preschool("phase2"), primary("village")], ["phase2", "village"])).toEqual({
      assessment: true,
      visit: true,
    });
  });

  it("no campus rows means head office, which sees every campus", () => {
    expect(bookingKindsInScope(offered, [])).toEqual({ assessment: true, visit: true });
  });

  it("the campus's own setting beats the grade's", () => {
    // A grade that assesses everywhere else, switched off at this campus.
    const overridden = [{ campusId: "sarona", requiresAssessment: false, gradeRequiresAssessment: true }];
    expect(bookingKindsInScope(overridden, ["sarona"])).toEqual({ assessment: false, visit: true });
  });

  it("names both when nothing is configured yet", () => {
    expect(bookingKindsInScope([], ["brand_new"])).toEqual({ assessment: true, visit: true });
    expect(bookingKindsInScope(offered, ["a_campus_with_no_grades"])).toEqual({ assessment: true, visit: true });
  });
});

describe("what the dashboard calls it", () => {
  const both = { assessment: true, visit: true };
  const visits = { assessment: false, visit: true };
  const assess = { assessment: true, visit: false };

  it("heads the board by what the scope does", () => {
    expect(todaysBoardTitle(both)).toBe("Today's assessments and visits");
    expect(todaysBoardTitle(visits)).toBe("Today's visits");
    expect(todaysBoardTitle(assess)).toBe("Today's assessments");
  });

  it("says the same when there is nothing to show", () => {
    expect(todaysBoardEmpty(visits)).toBe("No visits booked for today.");
    expect(todaysBoardEmpty(assess)).toBe("No assessments booked for today.");
    expect(todaysBoardEmpty(both)).toBe("Nothing booked for today.");
  });
});
