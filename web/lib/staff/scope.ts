/**
 * What the campuses a member of staff can see actually do.
 *
 * Every console page is already scoped by `staff_campuses` through RLS — this
 * decides only what to *call* things on the dashboard. A Phase 2 manager runs
 * visits and no assessments; head office, which has no `staff_campuses` rows
 * at all, runs both and should see one dashboard naming both rather than a
 * "pre-school mode" nobody set.
 *
 * Pure. The rule is small and the wrong answer is a board headed "Today's
 * assessments" above a list of three-year-olds, so it is worth a test.
 */

export type OfferedGrade = {
  campusId: string;
  /** `campus_grades.requires_assessment`. Null: follow the grade's own setting. */
  requiresAssessment: boolean | null;
  /** `grades.requires_assessment`, the fallback. */
  gradeRequiresAssessment: boolean;
};

export type ScopeKinds = {
  /** Somewhere in scope sits an assessment. */
  assessment: boolean;
  /** Somewhere in scope comes for a visit rather than an assessment. */
  visit: boolean;
};

/**
 * `myCampusIds` empty means every campus — that is what no `staff_campuses`
 * rows means for head office, and `can_access_campus()` reads it the same way.
 */
export function bookingKindsInScope(
  offered: readonly OfferedGrade[],
  myCampusIds: readonly string[]
): ScopeKinds {
  const mine = new Set(myCampusIds);
  const rows = mine.size === 0 ? offered : offered.filter((o) => mine.has(o.campusId));
  const kinds = { assessment: false, visit: false };
  for (const row of rows) {
    if (row.requiresAssessment ?? row.gradeRequiresAssessment) kinds.assessment = true;
    else kinds.visit = true;
  }
  // A scope with no grades configured yet is not a scope that runs nothing —
  // it is one nobody has set up. Naming both is the harmless answer; naming
  // neither would leave a blank heading over a list that still has rows in it.
  if (!kinds.assessment && !kinds.visit) return { assessment: true, visit: true };
  return kinds;
}

/** The heading over today's arrivals. */
export function todaysBoardTitle(kinds: ScopeKinds): string {
  if (kinds.assessment && kinds.visit) return "Today's assessments and visits";
  return kinds.visit ? "Today's visits" : "Today's assessments";
}

/** The same, as the empty state says it. */
export function todaysBoardEmpty(kinds: ScopeKinds): string {
  if (kinds.assessment && kinds.visit) return "Nothing booked for today.";
  return kinds.visit ? "No visits booked for today." : "No assessments booked for today.";
}

/**
 * The pipeline row counting `status = 'visit_booked'`, which holds both a
 * primary family's look around and a pre-school family's visit.
 *
 * It used to name the two separately — "Visits and play dates booked" where a
 * scope ran both. Now that the pre-school track says "visit" too, there is
 * one word for the row whatever the scope runs, so the label is a constant
 * and lives at its one call site rather than in a function that takes a
 * `ScopeKinds` and ignores it.
 */
