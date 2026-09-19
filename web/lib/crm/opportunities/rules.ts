import type { Json } from "@/lib/supabase/types";

/**
 * The opportunity rules, as a decision over facts.
 *
 * A rule's `conditions` is the JSON object described on
 * `opportunity_rules` (migration 20260919100100). This reads the keys it
 * knows and ignores the rest, so a rule authored before a key existed keeps
 * working, and decides for one child (a student rule) or one family (a
 * family rule) whether an opportunity should exist.
 *
 * Pure. The engine in `engine.ts` reads the facts and writes the rows.
 */

export type RuleConditions = {
  subject?: "student" | "family";
  grade_sort_min?: number;
  grade_sort_max?: number;
  campus_ids?: string[];
  student_statuses?: string[];
  not_registered_item?: string;
  multiple_children_one_enrolled?: boolean;
  reenrolment_outstanding?: boolean;
};

export function parseConditions(raw: Json | null | undefined): RuleConditions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, Json | undefined>;
  const num = (v: Json | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const strs = (v: Json | undefined) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  return {
    subject: o.subject === "family" ? "family" : "student",
    grade_sort_min: num(o.grade_sort_min),
    grade_sort_max: num(o.grade_sort_max),
    campus_ids: strs(o.campus_ids),
    student_statuses: strs(o.student_statuses),
    not_registered_item: typeof o.not_registered_item === "string" ? o.not_registered_item : undefined,
    multiple_children_one_enrolled: o.multiple_children_one_enrolled === true,
    reenrolment_outstanding: o.reenrolment_outstanding === true,
  };
}

export type StudentFacts = {
  id: string;
  family_id: string;
  campus_id: string;
  status: string;
  grade_sort: number | null;
  /** Codes of the catalogue items this child has selected or paid for. */
  registered_item_codes: readonly string[];
};

export type FamilyFacts = {
  id: string;
  campus_id: string | null;
  student_count: number;
  enrolled_count: number;
  reenrolment_outstanding: number;
};

const DEFAULT_STATUSES = ["onboarding", "active"];

/** Whether this child is a candidate under the rule. */
export function studentQualifies(c: RuleConditions, s: StudentFacts): boolean {
  if ((c.subject ?? "student") !== "student") return false;
  const statuses = c.student_statuses?.length ? c.student_statuses : DEFAULT_STATUSES;
  if (!statuses.includes(s.status)) return false;
  if (c.campus_ids?.length && !c.campus_ids.includes(s.campus_id)) return false;
  if (c.grade_sort_min !== undefined && (s.grade_sort === null || s.grade_sort < c.grade_sort_min)) return false;
  if (c.grade_sort_max !== undefined && (s.grade_sort === null || s.grade_sort > c.grade_sort_max)) return false;
  if (c.not_registered_item && s.registered_item_codes.includes(c.not_registered_item)) return false;
  return true;
}

/** Whether this family is a candidate under the rule. */
export function familyQualifies(c: RuleConditions, f: FamilyFacts): boolean {
  if (c.subject !== "family") return false;
  if (c.campus_ids?.length && (!f.campus_id || !c.campus_ids.includes(f.campus_id))) return false;
  if (c.multiple_children_one_enrolled && !(f.student_count >= 2 && f.enrolled_count === 1)) return false;
  if (c.reenrolment_outstanding && f.reenrolment_outstanding < 1) return false;
  // A family rule with no test at all would fire for every family.
  if (!c.multiple_children_one_enrolled && !c.reenrolment_outstanding && !c.campus_ids?.length) return false;
  return true;
}

/** A rule whose conversion the catalogue can see: the child now holds the item. */
export function convertedByCatalogue(c: RuleConditions, s: Pick<StudentFacts, "registered_item_codes">): boolean {
  return !!c.not_registered_item && s.registered_item_codes.includes(c.not_registered_item);
}

/** One sentence for the settings screen. */
export function describeConditions(c: RuleConditions, gradeName: (sort: number) => string | null = () => null): string {
  const parts: string[] = [];
  if ((c.subject ?? "student") === "student") {
    const min = c.grade_sort_min !== undefined ? (gradeName(c.grade_sort_min) ?? `sort ${c.grade_sort_min}`) : null;
    const max = c.grade_sort_max !== undefined ? (gradeName(c.grade_sort_max) ?? `sort ${c.grade_sort_max}`) : null;
    if (min && max) parts.push(`a child in ${min} to ${max}`);
    else if (min) parts.push(`a child from ${min} upward`);
    else if (max) parts.push(`a child up to ${max}`);
    else parts.push("any enrolled child");
    if (c.not_registered_item) parts.push(`not registered for "${c.not_registered_item}"`);
  } else {
    if (c.multiple_children_one_enrolled) parts.push("a family with more than one child and only one enrolled");
    if (c.reenrolment_outstanding) parts.push("a family with an unanswered re-enrolment question");
  }
  if (c.campus_ids?.length) parts.push(`at ${c.campus_ids.length} named campus${c.campus_ids.length === 1 ? "" : "es"}`);
  return parts.join(", ");
}
