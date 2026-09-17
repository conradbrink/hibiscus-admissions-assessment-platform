import { describe, expect, it } from "vitest";
import { formatMonth, intakeForMonth, isMonthStart, monthChoices, startLabel, startsOn } from "@/lib/start-month";

/** The school's real terms, as the funnel offers them in September 2026. */
const t3_2026 = { id: "t3-2026", label: "Term 3, 2026", starts_on: "2026-09-07" };
const t1_2027 = { id: "t1-2027", label: "Term 1, 2027", starts_on: "2027-01-11" };
const t2_2027 = { id: "t2-2027", label: "Term 2, 2027", starts_on: "2027-05-03" };
const t3_2027 = { id: "t3-2027", label: "Term 3, 2027", starts_on: "2027-09-06" };
const OFFERED = [t3_2026, t1_2027, t2_2027, t3_2027];

describe("isMonthStart", () => {
  it("accepts the first of a real month and nothing else", () => {
    expect(isMonthStart("2026-10-01")).toBe(true);
    expect(isMonthStart("2026-10-15")).toBe(false);
    expect(isMonthStart("2026-13-01")).toBe(false);
    expect(isMonthStart("2026-00-01")).toBe(false);
    expect(isMonthStart("October 2026")).toBe(false);
  });
});

describe("formatMonth", () => {
  it("names the month and the year, the way a parent says it", () => {
    expect(formatMonth("2026-10-01")).toBe("October 2026");
    expect(formatMonth("2027-01-01")).toBe("January 2027");
  });
});

describe("monthChoices", () => {
  it("offers this month and the eleven after it, across the year end", () => {
    const choices = monthChoices("2026-09-17");
    expect(choices).toHaveLength(12);
    expect(choices[0]).toEqual({ value: "2026-09-01", label: "September 2026" });
    expect(choices[3]).toEqual({ value: "2026-12-01", label: "December 2026" });
    expect(choices[4]).toEqual({ value: "2027-01-01", label: "January 2027" });
    expect(choices[11]).toEqual({ value: "2027-08-01", label: "August 2027" });
  });

  it("keeps December in step when the year turns inside the list", () => {
    expect(monthChoices("2026-12-31", 3).map((c) => c.value)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });
});

describe("intakeForMonth", () => {
  it("puts a month inside a running term on that term", () => {
    expect(intakeForMonth(OFFERED, "2026-10-01")?.id).toBe("t3-2026");
    expect(intakeForMonth(OFFERED, "2026-12-01")?.id).toBe("t3-2026");
  });

  it("puts January on the term that starts inside January", () => {
    // Term 1, 2027 begins on the 11th; a child starting "in January" is
    // starting that term, not the tail of the previous one.
    expect(intakeForMonth(OFFERED, "2027-01-01")?.id).toBe("t1-2027");
    expect(intakeForMonth(OFFERED, "2027-04-01")?.id).toBe("t1-2027");
    expect(intakeForMonth(OFFERED, "2027-05-01")?.id).toBe("t2-2027");
  });

  it("falls forward to the first term offered when the month is before all of them", () => {
    expect(intakeForMonth([t1_2027, t2_2027], "2026-11-01")?.id).toBe("t1-2027");
  });

  it("does not care what order the terms arrive in", () => {
    expect(intakeForMonth([t3_2027, t1_2027, t3_2026], "2027-02-01")?.id).toBe("t1-2027");
  });

  it("is null when nothing is offered", () => {
    expect(intakeForMonth([], "2026-10-01")).toBeNull();
  });
});

describe("what a page calls the start", () => {
  it("is the month where one was chosen, and the term otherwise", () => {
    expect(startLabel({ start_month: "2026-10-01" }, t3_2026)).toBe("October 2026");
    expect(startLabel({ start_month: null }, t3_2026)).toBe("Term 3, 2026");
  });

  it("starts on the first of the month, or the first day of term", () => {
    expect(startsOn({ start_month: "2026-10-01" }, t3_2026)).toBe("2026-10-01");
    expect(startsOn({ start_month: null }, t3_2026)).toBe("2026-09-07");
  });
});
