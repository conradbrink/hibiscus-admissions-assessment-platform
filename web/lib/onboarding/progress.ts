/**
 * What is still outstanding on a child's checklist, and how far along it is.
 *
 * Pure, and away from the database, because these are the judgements the
 * school will want to argue with: whether an optional step counts toward
 * "done", whether a blocked one is overdue, and which steps apply to a class
 * at all. The board and the parent's page read the same answers.
 *
 * There is deliberately no state machine here. The checklist is independent
 * errands — a uniform size on Tuesday, the class group on Saturday — and a
 * linear order would strand the family who did the fourth thing before the
 * second, then call them stuck.
 */

export type StepLike = {
  code: string;
  owner: "parent" | "staff" | "either";
  required: boolean;
  is_active: boolean;
  campus_id: string | null;
  grade_sort_min: number | null;
  grade_sort_max: number | null;
  sort_order: number;
};

export type ItemLike = {
  step_code: string;
  status: "pending" | "in_progress" | "done" | "not_applicable" | "blocked";
  due_on: string | null;
};

/**
 * Which steps a child gets. The same band convention as the document
 * requirements: null on either end means "no limit that side", and a child
 * with no class yet gets only the steps that apply to everyone.
 */
export function applicableSteps<T extends StepLike>(
  steps: readonly T[],
  where: { campusId: string; gradeSort: number | null }
): T[] {
  return steps
    .filter((s) => s.is_active)
    .filter((s) => s.campus_id === null || s.campus_id === where.campusId)
    .filter((s) => {
      if (s.grade_sort_min === null && s.grade_sort_max === null) return true;
      if (where.gradeSort === null) return false;
      if (s.grade_sort_min !== null && where.gradeSort < s.grade_sort_min) return false;
      if (s.grade_sort_max !== null && where.gradeSort > s.grade_sort_max) return false;
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Settled: nothing more will happen to it. */
export function isSettled(item: ItemLike): boolean {
  return item.status === "done" || item.status === "not_applicable";
}

/**
 * Overdue means past its date and still not settled. A blocked item counts —
 * it is the school's problem rather than the family's, but it is still a
 * thing that has not happened by the day it needed to.
 */
export function isOverdue(item: ItemLike, today: string): boolean {
  if (isSettled(item)) return false;
  return item.due_on !== null && item.due_on < today;
}

export type Progress = {
  /** Required steps only: an optional extra must never make a family look incomplete. */
  requiredTotal: number;
  requiredDone: number;
  /** 0–100, and 100 when there is nothing required — not NaN. */
  percent: number;
  outstanding: string[];
  overdue: string[];
  blocked: string[];
  complete: boolean;
};

export function onboardingProgress(
  steps: readonly StepLike[],
  items: readonly ItemLike[],
  today: string
): Progress {
  const byCode = new Map(steps.map((s) => [s.code, s]));
  const required = items.filter((i) => byCode.get(i.step_code)?.required ?? false);
  const requiredDone = required.filter(isSettled).length;

  const outstanding = items
    .filter((i) => !isSettled(i))
    .sort((a, b) => (byCode.get(a.step_code)?.sort_order ?? 0) - (byCode.get(b.step_code)?.sort_order ?? 0))
    .map((i) => i.step_code);

  return {
    requiredTotal: required.length,
    requiredDone,
    // A family with no required steps is not 0% done, and dividing by zero
    // would put NaN% on their page.
    percent: required.length === 0 ? 100 : Math.round((requiredDone / required.length) * 100),
    outstanding,
    overdue: items.filter((i) => isOverdue(i, today)).map((i) => i.step_code),
    blocked: items.filter((i) => i.status === "blocked").map((i) => i.step_code),
    complete: requiredDone === required.length,
  };
}

/** What the parent is shown: their own steps, unsettled first, in the school's order. */
export function parentChecklist<T extends ItemLike>(
  steps: readonly StepLike[],
  items: readonly T[]
): T[] {
  const byCode = new Map(steps.map((s) => [s.code, s]));
  return items
    .filter((i) => {
      const owner = byCode.get(i.step_code)?.owner;
      return owner === "parent" || owner === "either";
    })
    .sort((a, b) => {
      const settled = Number(isSettled(a)) - Number(isSettled(b));
      if (settled !== 0) return settled;
      return (byCode.get(a.step_code)?.sort_order ?? 0) - (byCode.get(b.step_code)?.sort_order ?? 0);
    });
}
