import { describe, expect, it } from "vitest";
import { ageOn, isPlausibleDateOfBirth, parkingGrade, recommendGrade } from "@/lib/grades";

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

describe("two ladders, one age", () => {
  // Potchefstroom teaches the South African classes and everywhere else
  // teaches the Botswana ones. They collide on age: a child turning four is
  // Grade RR in the one and Pre-Reception in the other.
  const SOUTH_AFRICAN = [grade("babies", null), grade("toddlers", 2), grade("junior", 3), grade("grade_rr", 4), grade("grade_r", 5)];
  const BOTSWANA = [grade("nursery", null), grade("pre_kindergarten", 2), grade("kindergarten", 3), grade("pre_reception", 4), grade("reception", 5)];

  it("answers with the campus's own class, not the other country's", () => {
    const sa = recommendGrade("2022-03-01", "2026-07-31", SOUTH_AFRICAN);
    const bw = recommendGrade("2022-03-01", "2026-07-31", BOTSWANA);
    expect(sa.kind === "grade" && sa.grade.code).toBe("grade_rr");
    expect(bw.kind === "grade" && bw.grade.code).toBe("pre_reception");
  });

  it("would answer every campus in South African if both ladders were offered at once", () => {
    // The bug this guards: the South African grades sort first, so a single
    // catalogue-wide recommendation wins for both countries. The caller must
    // narrow to the campus before asking.
    const both = [...SOUTH_AFRICAN, ...BOTSWANA];
    const rec = recommendGrade("2022-03-01", "2026-07-31", both);
    expect(rec.kind === "grade" && rec.grade.code).toBe("grade_rr");
  });

  it("falls to the rolling class in each ladder for a child below the youngest ruled age", () => {
    const sa = recommendGrade("2025-06-01", "2026-07-31", SOUTH_AFRICAN);
    const bw = recommendGrade("2025-06-01", "2026-07-31", BOTSWANA);
    expect(sa.kind === "grade" && sa.grade.code).toBe("babies");
    expect(bw.kind === "grade" && bw.grade.code).toBe("nursery");
  });
});

describe("a campus whose ladder has no class for a young child", () => {
  // Block 7 and Broadhurst teach primary and secondary only. Their lowest
  // class is Reception (turning 5) and neither has a rolling class, because
  // Nursery is a pre-school class taught at the pre-school campuses. So a
  // three-year-old whose parent picks Block 7 matches nothing at all.
  //
  // This is the shape the old tests never had: every case above hands
  // `recommendGrade` the full LADDER, which contains `nursery`, so the
  // `age < youngest` branch always found a rolling class and the bug below
  // could not show itself.
  const BLOCK_7 = [
    grade("reception", 5),
    grade("stage_1", 6),
    grade("stage_7", 12),
    grade("form_1", 12),
    grade("form_5", 16),
  ];

  it("says too young, not too old", () => {
    // The reported child: born 13 September 2022, so three on the cut-off.
    const r = recommendGrade("2022-09-13", "2026-07-31", BLOCK_7);
    expect(r.kind).toBe("too_young");
    expect(r.kind === "too_young" && r.ageOnCutoff).toBe(3);
  });

  it("still places a child the campus does teach", () => {
    // The fix must not move the cases that already worked.
    const five = recommendGrade("2021-03-01", "2026-07-31", BLOCK_7);
    expect(five.kind === "grade" && five.grade.code).toBe("reception");
    const six = recommendGrade("2020-03-07", "2026-07-31", BLOCK_7);
    expect(six.kind === "grade" && six.grade.code).toBe("stage_1");
  });

  it("still says too old for somebody past the top of the ladder", () => {
    const r = recommendGrade("2005-01-01", "2026-07-31", BLOCK_7);
    expect(r.kind).toBe("too_old");
  });

  it("keeps sending the young to the rolling class where there is one", () => {
    // The same child at a pre-school campus is answered properly, which is
    // why this was only ever visible at two of the nine campuses.
    const r = recommendGrade("2022-09-13", "2026-07-31", LADDER);
    expect(r.kind === "grade" && r.grade.code).toBe("kindergarten");
  });
});

describe("where an unmatched application is parked", () => {
  // `recommendGrade` says nothing fits; this is what the family's application
  // is created as, until the confirmation screen asks the parent.
  const BLOCK_7 = [
    { id: "reception" },
    { id: "stage_1" },
    { id: "form_1" },
    { id: "form_5" },
  ];

  it("puts a child who is too young at the bottom, not the top", () => {
    // The bug, stated plainly: this returned form_5 for a three-year-old.
    expect(parkingGrade("too_young", BLOCK_7)?.id).toBe("reception");
  });

  it("puts a child who is too old at the top", () => {
    // And the reason the verdicts had to be split: parking everybody at the
    // bottom would file a sixth-former as a five-year-old instead.
    expect(parkingGrade("too_old", BLOCK_7)?.id).toBe("form_5");
  });

  it("treats an unreadable date of birth as the gentler end", () => {
    expect(parkingGrade("invalid", BLOCK_7)?.id).toBe("reception");
  });

  it("has nothing to park on when the campus teaches nothing", () => {
    expect(parkingGrade("too_young", [])).toBeNull();
  });
});
