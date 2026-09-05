import { describe, expect, it } from "vitest";
import { ageOn, isPlausibleDateOfBirth, recommendGrade } from "@/lib/grades";
import type { GradeRow } from "@/lib/supabase/types";

const grade = (code: string, age: number | null, active = true): GradeRow => ({
  id: code,
  code,
  name: code,
  phase: "primary",
  sort_order: 0,
  age_turning: age,
  requires_assessment: age !== null && age >= 5,
  is_active: active,
  created_at: "",
  updated_at: "",
});

const LADDER = [
  grade("nursery", null),
  grade("pre_kindergarten", 2),
  grade("kindergarten", 3),
  grade("pre_reception", 4),
  grade("reception", 5),
  grade("stage_1", 6),
  grade("stage_3", 8),
  grade("stage_4", 9),
  grade("stage_7", 12, false),
  grade("form_1", 12),
  grade("form_5", 16),
];

describe("ageOn", () => {
  it("counts full years, birthday on the reference date included", () => {
    expect(ageOn("2017-07-31", "2026-07-31")).toBe(9);
    expect(ageOn("2017-08-01", "2026-07-31")).toBe(8);
    expect(ageOn("2017-04-15", "2026-07-31")).toBe(9);
  });
  it("handles a 29 February birthday", () => {
    expect(ageOn("2016-02-29", "2026-07-31")).toBe(10);
    expect(ageOn("2016-02-29", "2026-02-28")).toBe(9);
    expect(ageOn("2016-02-29", "2026-03-01")).toBe(10);
  });
  it("rejects malformed and impossible dates", () => {
    expect(ageOn("2017-13-01", "2026-07-31")).toBeNull();
    expect(ageOn("2017-02-30", "2026-07-31")).toBeNull();
    expect(ageOn("15/04/2017", "2026-07-31")).toBeNull();
  });
});

describe("recommendGrade", () => {
  it("matches the published rule: turning 9 before end July is Stage 4", () => {
    const r = recommendGrade("2017-04-15", "2026-07-31", LADDER);
    expect(r.kind).toBe("grade");
    if (r.kind === "grade") expect(r.grade.code).toBe("stage_4");
  });
  it("is a grade apart either side of the cut-off", () => {
    const before = recommendGrade("2017-07-31", "2026-07-31", LADDER);
    const after = recommendGrade("2017-08-01", "2026-07-31", LADDER);
    expect(before.kind === "grade" && before.grade.code).toBe("stage_4");
    expect(after.kind === "grade" && after.grade.code).toBe("stage_3");
  });
  it("sends the very young to the rolling grade", () => {
    const r = recommendGrade("2025-10-01", "2026-07-31", LADDER);
    expect(r.kind === "grade" && r.grade.code).toBe("nursery");
  });
  it("ignores inactive grades even when the age matches", () => {
    const r = recommendGrade("2014-05-01", "2026-07-31", LADDER);
    expect(r.kind === "grade" && r.grade.code).toBe("form_1");
  });
  it("reports too old rather than guessing", () => {
    const r = recommendGrade("2005-01-01", "2026-07-31", LADDER);
    expect(r.kind).toBe("too_old");
  });
  it("reports invalid for a future date of birth", () => {
    expect(recommendGrade("2030-01-01", "2026-07-31", LADDER).kind).toBe("invalid");
  });
});

describe("isPlausibleDateOfBirth", () => {
  it("accepts a school-age child and rejects the absurd", () => {
    expect(isPlausibleDateOfBirth("2017-04-15", "2026-09-04")).toBe(true);
    expect(isPlausibleDateOfBirth("1990-04-15", "2026-09-04")).toBe(false);
    expect(isPlausibleDateOfBirth("2027-01-01", "2026-09-04")).toBe(false);
  });
});
