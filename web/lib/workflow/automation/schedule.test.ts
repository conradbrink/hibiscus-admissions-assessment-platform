import { describe, expect, it } from "vitest";
import { isClosed, planSessions, schoolDate, schoolInstant, weekdaysAhead } from "@/lib/workflow/automation/schedule";

describe("schoolDate", () => {
  it("is the Gaborone calendar date, two hours ahead of UTC", () => {
    expect(schoolDate(new Date("2026-09-07T22:30:00Z"))).toBe("2026-09-08");
    expect(schoolDate(new Date("2026-09-07T21:59:00Z"))).toBe("2026-09-07");
  });
});

describe("weekdaysAhead", () => {
  it("starts tomorrow, skips weekends, and covers whole weeks", () => {
    // 2026-09-07 is a Monday.
    const days = weekdaysAhead("2026-09-07", 1);
    expect(days).toEqual(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"]);
  });
  it("never includes the day itself", () => {
    expect(weekdaysAhead("2026-09-11", 1)).not.toContain("2026-09-11");
  });
});

describe("isClosed", () => {
  const closures = [
    { campus_id: null, starts_on: "2026-09-30", ends_on: "2026-10-01" },
    { campus_id: "block7", starts_on: "2026-09-15", ends_on: "2026-09-15" },
  ];
  it("applies a school-wide closure to every campus, inclusive of both ends", () => {
    expect(isClosed("2026-09-30", "broadhurst", closures)).toBe(true);
    expect(isClosed("2026-10-01", "block7", closures)).toBe(true);
    expect(isClosed("2026-10-02", "block7", closures)).toBe(false);
  });
  it("applies a campus closure to that campus alone", () => {
    expect(isClosed("2026-09-15", "block7", closures)).toBe(true);
    expect(isClosed("2026-09-15", "broadhurst", closures)).toBe(false);
  });
});

describe("schoolInstant", () => {
  it("reads the clock in UTC+2", () => {
    expect(schoolInstant("2026-09-08", 540).toISOString()).toBe("2026-09-08T07:00:00.000Z");
    expect(schoolInstant("2026-09-08", 600).toISOString()).toBe("2026-09-08T08:00:00.000Z");
  });
});

describe("planSessions", () => {
  const rules = [
    { kind: "assessment" as const, startMinutes: 540, durationMinutes: 90 },
    { kind: "visit" as const, startMinutes: 600, durationMinutes: 60 },
  ];
  it("plans one session per rule per open weekday per campus", () => {
    const plan = planSessions({
      today: "2026-09-07",
      weeksAhead: 1,
      campusIds: ["a", "b"],
      closures: [{ campus_id: null, starts_on: "2026-09-10", ends_on: "2026-09-10" }],
      rules,
      existing: [],
    });
    // 5 weekdays, one closed, two campuses, two rules.
    expect(plan).toHaveLength(4 * 2 * 2);
    expect(plan.some((p) => p.date === "2026-09-10")).toBe(false);
    const first = plan.find((p) => p.campus_id === "a" && p.kind === "assessment" && p.date === "2026-09-08");
    expect(first?.starts_at).toBe("2026-09-08T07:00:00.000Z");
    expect(first?.ends_at).toBe("2026-09-08T08:30:00.000Z");
  });
  it("leaves a day alone when a session of that kind already exists there, whoever made it", () => {
    const plan = planSessions({
      today: "2026-09-07",
      weeksAhead: 1,
      campusIds: ["a"],
      closures: [],
      rules,
      existing: [{ campus_id: "a", kind: "assessment", starts_at: "2026-09-08T12:00:00Z" }],
    });
    expect(plan.filter((p) => p.date === "2026-09-08").map((p) => p.kind)).toEqual(["visit"]);
    expect(plan.filter((p) => p.date === "2026-09-09")).toHaveLength(2);
  });
  it("plans nothing with no campuses or no rules", () => {
    expect(planSessions({ today: "2026-09-07", weeksAhead: 2, campusIds: [], closures: [], rules, existing: [] })).toEqual([]);
    expect(planSessions({ today: "2026-09-07", weeksAhead: 2, campusIds: ["a"], closures: [], rules: [], existing: [] })).toEqual([]);
  });
});
