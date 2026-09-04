import type { GradeRow } from "@/lib/supabase/types";

/**
 * The age-to-grade rule.
 *
 * The school publishes it as "Stage 4 — children turning 9 before end July".
 * That is: a child's age on the academic year's cut-off date (31 July of that
 * year) is matched against each grade's `age_turning`. Deterministic, and
 * testable at the boundaries — a child born on 31 July and one born on
 * 1 August of the same year are a grade apart, and this module is where that
 * is proven rather than assumed.
 *
 * Nursery has no published age rule ("children turning 1") and is treated as
 * the grade for any child younger than the youngest ruled grade.
 */

/** Parses "YYYY-MM-DD" without timezone drift. */
function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject 31 February and friends: round-trip through UTC and compare.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

/**
 * Full years between a date of birth and a reference date, both "YYYY-MM-DD".
 * A birthday *on* the reference date counts as reached.
 */
export function ageOn(dateOfBirth: string, on: string): number | null {
  const dob = parseDateOnly(dateOfBirth);
  const ref = parseDateOnly(on);
  if (!dob || !ref) return null;
  let age = ref.y - dob.y;
  if (ref.m < dob.m || (ref.m === dob.m && ref.d < dob.d)) age -= 1;
  return age;
}

export type GradeRecommendation =
  | { kind: "grade"; grade: GradeRow; ageOnCutoff: number }
  | { kind: "too_old"; ageOnCutoff: number }
  | { kind: "invalid" };

type GradeLike = Pick<GradeRow, "id" | "code" | "name" | "age_turning" | "is_active" | "sort_order">;

/**
 * Recommends a grade for a child, given the cut-off date of the intake's
 * academic year and the grade ladder.
 *
 * Only active grades are candidates. The caller filters further by what the
 * chosen campus offers; a recommendation the campus cannot honour is shown
 * with an explanation, not silently swapped.
 */
export function recommendGrade<G extends GradeLike>(
  dateOfBirth: string,
  cutoffOn: string,
  grades: readonly G[]
): { kind: "grade"; grade: G; ageOnCutoff: number } | { kind: "too_old"; ageOnCutoff: number } | { kind: "invalid" } {
  const age = ageOn(dateOfBirth, cutoffOn);
  if (age === null || age < 0) return { kind: "invalid" };

  const active = grades.filter((g) => g.is_active);
  const exact = active.find((g) => g.age_turning === age);
  if (exact) return { kind: "grade", grade: exact, ageOnCutoff: age };

  const ruled = active.filter((g) => g.age_turning !== null);
  const youngest = Math.min(...ruled.map((g) => g.age_turning as number));
  if (age < youngest) {
    const rolling = active.find((g) => g.age_turning === null);
    if (rolling) return { kind: "grade", grade: rolling, ageOnCutoff: age };
  }
  return { kind: "too_old", ageOnCutoff: age };
}

/**
 * Whether a date of birth is plausible for a school applicant at all. Used by
 * the enquiry form before anything is saved: a typo that makes the child 40
 * or unborn is caught on the field, not in the pipeline.
 */
export function isPlausibleDateOfBirth(dateOfBirth: string, today: string): boolean {
  const age = ageOn(dateOfBirth, today);
  return age !== null && age >= 0 && age <= 21;
}
