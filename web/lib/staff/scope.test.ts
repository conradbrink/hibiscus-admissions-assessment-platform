import { describe, expect, it } from "vitest";
import { bookedRowLabel, bookingKindsInScope, todaysBoardEmpty, todaysBoardTitle, type OfferedGrade } from "./scope";

const preschool = (campusId: string): OfferedGrade => ({ campusId, requiresAssessment: null, gradeRequiresAssessment: false });
const primary = (campusId: string): OfferedGrade => ({ campusId, requiresAssessment: null, gradeRequiresAssessment: true });

describe("bookingKindsInScope", () => {
  const offered = [preschool("phase2"), primary("block7"), preschool("block7")];

  it("a pre-school campus runs play dates and no assessments", () => {
    expect(bookingKindsInScope(offered, ["phase2"])).toEqual({ assessment: false, playDate: true });
  });

  it("a campus with both runs both", () => {
    expect(bookingKindsInScope(offered, ["block7"])).toEqual({ assessment: true, playDate: true });
  });

  it("somebody scoped to a pre-school and a primary gets one scope covering both", () => {
    // The mixed case the dashboard has to get right: not two dashboards, and
    // not the first campus's answer applied to the second.
    expect(bookingKindsInScope([preschool("phase2"), primary("village")], ["phase2", "village"])).toEqual({
      assessment: true,
      playDate: true,
    });
  });

  it("no campus rows means head office, which sees every campus", () => {
    expect(bookingKindsInScope(offered, [])).toEqual({ assessment: true, playDate: true });
  });

  it("the campus's own setting beats the grade's", () => {
    // A grade that assesses everywhere else, switched off at this campus.
    const overridden = [{ campusId: "sarona", requiresAssessment: false, gradeRequiresAssessment: true }];
    expect(bookingKindsInScope(overridden, ["sarona"])).toEqual({ assessment: false, playDate: true });
  });

  it("names both when nothing is configured yet", () => {
    expect(bookingKindsInScope([], ["brand_new"])).toEqual({ assessment: true, playDate: true });
    expect(bookingKindsInScope(offered, ["a_campus_with_no_grades"])).toEqual({ assessment: true, playDate: true });
  });
});

describe("what the dashboard calls it", () => {
  const both = { assessment: true, playDate: true };
  const play = { assessment: false, playDate: true };
  const assess = { assessment: true, playDate: false };

  it("heads the board by what the scope does", () => {
    expect(todaysBoardTitle(both)).toBe("Today's assessments and play dates");
    expect(todaysBoardTitle(play)).toBe("Today's play dates");
    expect(todaysBoardTitle(assess)).toBe("Today's assessments");
  });

  it("says the same when there is nothing to show", () => {
    expect(todaysBoardEmpty(play)).toBe("No play dates booked for today.");
    expect(todaysBoardEmpty(assess)).toBe("No assessments booked for today.");
    expect(todaysBoardEmpty(both)).toBe("Nothing booked for today.");
  });

  it("names the pipeline row for both kinds of look around", () => {
    expect(bookedRowLabel(both)).toBe("Visits and play dates booked");
    expect(bookedRowLabel(play)).toBe("Play dates booked");
    expect(bookedRowLabel(assess)).toBe("Visits booked");
  });
});
