import { describe, expect, it } from "vitest";
import { isClosed, planSessions, schoolDate, schoolInstant, schoolMinutes, weekdaysAhead } from "@/lib/workflow/automation/schedule";

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

describe("schoolMinutes", () => {
  it("is the inverse of schoolInstant", () => {
    for (const m of [0, 480, 570, 660, 1439]) {
      expect(schoolMinutes(schoolInstant("2026-09-08", m))).toBe(m);
    }
  });
  it("reads an instant late enough to be tomorrow in Gaborone off the Gaborone clock", () => {
    // 22:30 UTC is 00:30 the next day at school; the date rolls over and so
    // does the reading, which is what keys a slot correctly.
    const at = new Date("2026-09-07T22:30:00Z");
    expect(schoolDate(at)).toBe("2026-09-08");
    expect(schoolMinutes(at)).toBe(30);
  });
});

describe("planSessions", () => {
  // The school's day: an assessment sitting and a school visit at each of
  // 08:00, 09:30 and 11:00.
  const STARTS = [480, 570, 660];
  const rules = [
    ...STARTS.map((startMinutes) => ({ kind: "assessment" as const, startMinutes, durationMinutes: 90 })),
    ...STARTS.map((startMinutes) => ({ kind: "visit" as const, startMinutes, durationMinutes: 60 })),
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
    // 5 weekdays, one closed, two campuses, six rules.
    expect(plan).toHaveLength(4 * 2 * 6);
    expect(plan.some((p) => p.date === "2026-09-10")).toBe(false);
    const first = plan.find((p) => p.campus_id === "a" && p.kind === "assessment" && p.date === "2026-09-08");
    expect(first?.starts_at).toBe("2026-09-08T06:00:00.000Z");
    expect(first?.ends_at).toBe("2026-09-08T07:30:00.000Z");
  });
  it("plans every time of a kind on the same day", () => {
    // The bug this replaced: the first rule of a kind claimed the whole day
    // and the other two were dropped without a word.
    const plan = planSessions({
      today: "2026-09-07",
      weeksAhead: 1,
      campusIds: ["a"],
      closures: [],
      rules,
      existing: [],
    });
    const day = plan.filter((p) => p.date === "2026-09-08");
    expect(day.filter((p) => p.kind === "assessment").map((p) => p.starts_at)).toEqual([
      "2026-09-08T06:00:00.000Z",
      "2026-09-08T07:30:00.000Z",
      "2026-09-08T09:00:00.000Z",
    ]);
    expect(day.filter((p) => p.kind === "visit")).toHaveLength(3);
  });
  it("leaves a time alone when a session of that kind already sits there, whoever made it", () => {
    const plan = planSessions({
      today: "2026-09-07",
      weeksAhead: 1,
      campusIds: ["a"],
      closures: [],
      rules,
      // 09:30 school time on the 8th.
      existing: [{ campus_id: "a", kind: "assessment", starts_at: "2026-09-08T07:30:00Z" }],
    });
    const day = plan.filter((p) => p.date === "2026-09-08");
    expect(day.filter((p) => p.kind === "assessment").map((p) => p.starts_at)).toEqual([
      "2026-09-08T06:00:00.000Z",
      "2026-09-08T09:00:00.000Z",
    ]);
    // The visit at that time is a different kind, so it is untouched.
    expect(day.filter((p) => p.kind === "visit")).toHaveLength(3);
    expect(plan.filter((p) => p.date === "2026-09-09")).toHaveLength(6);
  });
  it("is not suppressed by a session at an unrelated time", () => {
    // A one-off sitting at 13:10 is an extra, not a replacement — which is
    // what used to happen when the key was the day rather than the time.
    const plan = planSessions({
      today: "2026-09-07",
      weeksAhead: 1,
      campusIds: ["a"],
      closures: [],
      rules,
      existing: [{ campus_id: "a", kind: "assessment", starts_at: "2026-09-08T11:10:00Z" }],
    });
    expect(plan.filter((p) => p.date === "2026-09-08")).toHaveLength(6);
  });
  it("keeps campuses apart", () => {
    const plan = planSessions({
      today: "2026-09-07",
      weeksAhead: 1,
      campusIds: ["a", "b"],
      closures: [],
      rules,
      existing: [{ campus_id: "a", kind: "assessment", starts_at: "2026-09-08T06:00:00Z" }],
    });
    expect(plan.filter((p) => p.campus_id === "a" && p.date === "2026-09-08")).toHaveLength(5);
    expect(plan.filter((p) => p.campus_id === "b" && p.date === "2026-09-08")).toHaveLength(6);
  });
  it("plans nothing with no campuses or no rules", () => {
    expect(planSessions({ today: "2026-09-07", weeksAhead: 2, campusIds: [], closures: [], rules, existing: [] })).toEqual([]);
    expect(planSessions({ today: "2026-09-07", weeksAhead: 2, campusIds: ["a"], closures: [], rules: [], existing: [] })).toEqual([]);
  });
});
