import { LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { HEARD_FROM_OPTIONS } from "@/lib/heard-from";
import type { CrmFamilyFactsRow } from "@/lib/supabase/types";

/**
 * Segment rules: what a person can ask of a family, and how each question is
 * put to the database.
 *
 * A segment is an array of rules, all of which must hold. Every rule names a
 * field of `v_crm_family_facts`, an operator and a value. This file is the
 * closed list of fields and operators: `validateRules` refuses anything
 * else at save time, `applyRules` turns a list into PostgREST filters so the
 * count and the list are the database's answer, and `matchesRules` is the
 * same decision over one row in memory — for the tests, and so the two can
 * be checked against each other.
 *
 * Pure. No server-only import: the segment builder previews rules in the
 * browser.
 */

export type RuleOp = "eq" | "neq" | "in" | "not_in" | "gte" | "lte" | "is_true" | "is_false" | "contains" | "not_contains" | "older_than_days" | "within_days" | "is_null" | "is_not_null";

export type Rule = { field: string; op: RuleOp; value?: string | number | boolean | string[] | number[] | null };

export type RuleFieldKind = "select" | "multi" | "number" | "boolean" | "text" | "days" | "campus" | "grade" | "staff" | "tag" | "item" | "opportunity_type";

export type RuleField = {
  key: string;
  label: string;
  kind: RuleFieldKind;
  ops: readonly RuleOp[];
  /** For a select or multi: the options, when they are fixed. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  hint?: string;
};

const EQ_IN: readonly RuleOp[] = ["eq", "neq", "in", "not_in"];

export const RULE_FIELDS: readonly RuleField[] = [
  { key: "campus_id", label: "Campus", kind: "campus", ops: EQ_IN },
  {
    key: "lifecycle_stage",
    label: "Lifecycle stage",
    kind: "select",
    ops: EQ_IN,
    options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
  },
  { key: "is_active", label: "Active family", kind: "boolean", ops: ["is_true", "is_false"] },
  { key: "grade_ids", label: "A child in grade", kind: "grade", ops: ["contains", "not_contains"], hint: "Any child of the family is in this grade." },
  { key: "grade_sorts", label: "Grade band (sort order)", kind: "number", ops: ["gte", "lte"], hint: "Grades are ordered; Reception is 50, Stage 1 is 60, Stage 7 is 120, Form 1 is 130." },
  { key: "student_count", label: "Children known to us", kind: "number", ops: ["gte", "lte", "eq"] },
  { key: "enrolled_count", label: "Children enrolled", kind: "number", ops: ["gte", "lte", "eq"] },
  { key: "student_statuses", label: "A child with status", kind: "select", ops: ["contains", "not_contains"], options: [
    { value: "onboarding", label: "Starting" }, { value: "active", label: "Attending" }, { value: "on_leave", label: "On leave" }, { value: "left", label: "Left" }, { value: "graduated", label: "Graduated" },
  ] },
  { key: "registered_item_codes", label: "Registered for (catalogue code)", kind: "item", ops: ["contains", "not_contains"], hint: "The code of an item in the optional extras catalogue: robotics, swimming, transport, aftercare." },
  { key: "open_opportunity_types", label: "Has an open opportunity of type", kind: "opportunity_type", ops: ["contains", "not_contains"] },
  { key: "reenrolment_outstanding", label: "Re-enrolment questions unanswered", kind: "number", ops: ["gte", "eq"] },
  { key: "lead_source", label: "How they heard about us", kind: "select", ops: [...EQ_IN, "is_null", "is_not_null"], options: HEARD_FROM_OPTIONS.map((o) => ({ value: o.key, label: o.label })) },
  { key: "assigned_staff_id", label: "Assigned to", kind: "staff", ops: ["eq", "neq", "is_null", "is_not_null"] },
  { key: "tags", label: "Tag", kind: "tag", ops: ["contains", "not_contains"] },
  { key: "last_contact_at", label: "Last contact", kind: "days", ops: ["older_than_days", "within_days", "is_null"], hint: "Days ago. \"Older than 30\" is a family nobody has spoken to in a month." },
  { key: "created_at", label: "Family created", kind: "days", ops: ["older_than_days", "within_days"] },
  { key: "next_follow_up_at", label: "Follow-up due", kind: "days", ops: ["within_days", "older_than_days", "is_null", "is_not_null"] },
  { key: "primary_marketing_email_consent", label: "Consents to marketing email", kind: "boolean", ops: ["is_true", "is_false"] },
  { key: "primary_marketing_whatsapp_consent", label: "Consents to marketing WhatsApp", kind: "boolean", ops: ["is_true", "is_false"] },
  { key: "primary_whatsapp_opt_in", label: "WhatsApp updates on", kind: "boolean", ops: ["is_true", "is_false"] },
  { key: "open_application_count", label: "Open applications", kind: "number", ops: ["gte", "eq"] },
  { key: "open_task_count", label: "Open tasks", kind: "number", ops: ["gte", "eq"] },
];

export const RULE_OP_LABELS: Record<RuleOp, string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  not_in: "is none of",
  gte: "is at least",
  lte: "is at most",
  is_true: "is yes",
  is_false: "is no",
  contains: "includes",
  not_contains: "does not include",
  older_than_days: "more than N days ago",
  within_days: "within the last N days",
  is_null: "is not set",
  is_not_null: "is set",
};

export function ruleField(key: string): RuleField | null {
  return RULE_FIELDS.find((f) => f.key === key) ?? null;
}

export type RuleProblem = { index: number; message: string };

/** Refuses a rule that names an unknown field, an operator the field lacks, or a value of the wrong shape. */
export function validateRules(rules: unknown): { ok: true; rules: Rule[] } | { ok: false; problems: RuleProblem[] } {
  if (!Array.isArray(rules)) return { ok: false, problems: [{ index: -1, message: "Rules must be a list." }] };
  const problems: RuleProblem[] = [];
  const clean: Rule[] = [];
  rules.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return problems.push({ index, message: "Not a rule." });
    const r = raw as Partial<Rule>;
    const field = typeof r.field === "string" ? ruleField(r.field) : null;
    if (!field) return problems.push({ index, message: `Unknown field "${String(r.field)}".` });
    if (typeof r.op !== "string" || !field.ops.includes(r.op as RuleOp)) return problems.push({ index, message: `"${field.label}" cannot be tested with "${String(r.op)}".` });
    const op = r.op as RuleOp;
    const v = r.value;
    const needsNone = op === "is_true" || op === "is_false" || op === "is_null" || op === "is_not_null";
    if (needsNone) return clean.push({ field: field.key, op });
    if (op === "in" || op === "not_in") {
      if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "string")) return problems.push({ index, message: `"${field.label}" needs a list of values.` });
      return clean.push({ field: field.key, op, value: v as string[] });
    }
    if (op === "gte" || op === "lte" || op === "older_than_days" || op === "within_days" || (op === "eq" && field.kind === "number")) {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) return problems.push({ index, message: `"${field.label}" needs a number.` });
      return clean.push({ field: field.key, op, value: n });
    }
    if (typeof v !== "string" || v.trim() === "") return problems.push({ index, message: `"${field.label}" needs a value.` });
    clean.push({ field: field.key, op, value: v.trim() });
  });
  return problems.length ? { ok: false, problems } : { ok: true, rules: clean };
}

/** The smallest thing a PostgREST query builder offers, so this file needs no supabase import. */
export type Filterable<T> = {
  eq(column: string, value: unknown): T;
  neq(column: string, value: unknown): T;
  in(column: string, values: readonly unknown[]): T;
  not(column: string, operator: string, value: unknown): T;
  gte(column: string, value: unknown): T;
  lte(column: string, value: unknown): T;
  lt(column: string, value: unknown): T;
  is(column: string, value: null | boolean): T;
  contains(column: string, value: readonly unknown[]): T;
  or(filters: string): T;
};

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/**
 * Turns rules into filters on the facts view. Array fields use `cs`
 * (contains) and its negation; a grade band tests the array with an `or`
 * on the overlapping range, which PostgREST cannot express for an int
 * array, so it is applied by `matchesRules` after the read instead — see
 * `NEEDS_POST_FILTER`.
 */
export function applyRules<T extends Filterable<T>>(query: T, rules: readonly Rule[], now: Date = new Date()): T {
  let q = query;
  for (const r of rules) {
    const field = ruleField(r.field);
    if (!field) continue;
    if (NEEDS_POST_FILTER.has(r.field)) continue;
    const arrayField = field.kind === "grade" || field.kind === "tag" || field.kind === "item" || field.kind === "opportunity_type" || r.field === "student_statuses";
    switch (r.op) {
      case "eq":
        q = q.eq(r.field, r.value);
        break;
      case "neq":
        q = q.neq(r.field, r.value);
        break;
      case "in":
        q = q.in(r.field, r.value as string[]);
        break;
      case "not_in":
        q = q.not(r.field, "in", `(${(r.value as string[]).map((v) => `"${v}"`).join(",")})`);
        break;
      case "gte":
        q = q.gte(r.field, r.value);
        break;
      case "lte":
        q = q.lte(r.field, r.value);
        break;
      case "is_true":
        q = q.is(r.field, true);
        break;
      case "is_false":
        // A null consent (no primary contact) is not "no": it is nobody to ask.
        q = q.is(r.field, false);
        break;
      case "contains":
        if (arrayField) q = q.contains(r.field, [r.value]);
        break;
      case "not_contains":
        if (arrayField) q = q.not(r.field, "cs", `{${JSON.stringify(String(r.value))}}`);
        break;
      case "older_than_days":
        q = q.lt(r.field, daysAgoIso(Number(r.value), now));
        break;
      case "within_days":
        q = q.gte(r.field, daysAgoIso(Number(r.value), now));
        break;
      case "is_null":
        q = q.is(r.field, null);
        break;
      case "is_not_null":
        q = q.not(r.field, "is", null);
        break;
    }
  }
  return q;
}

/** Fields the query cannot filter on its own; `matchesRules` finishes the job over the rows read. */
export const NEEDS_POST_FILTER: ReadonlySet<string> = new Set(["grade_sorts"]);

export function needsPostFilter(rules: readonly Rule[]): boolean {
  return rules.some((r) => NEEDS_POST_FILTER.has(r.field));
}

/** The same decision as `applyRules`, over one row in memory. */
export function matchesRules(row: CrmFamilyFactsRow, rules: readonly Rule[], now: Date = new Date()): boolean {
  return rules.every((r) => matchesRule(row, r, now));
}

function matchesRule(row: CrmFamilyFactsRow, r: Rule, now: Date): boolean {
  const raw = (row as unknown as Record<string, unknown>)[r.field];
  switch (r.op) {
    case "eq":
      return raw === r.value;
    case "neq":
      return raw !== r.value;
    case "in":
      return (r.value as string[]).includes(String(raw));
    case "not_in":
      return !(r.value as string[]).includes(String(raw));
    case "gte":
      if (Array.isArray(raw)) return (raw as number[]).some((n) => n >= Number(r.value));
      return typeof raw === "number" && raw >= Number(r.value);
    case "lte":
      if (Array.isArray(raw)) return (raw as number[]).some((n) => n <= Number(r.value));
      return typeof raw === "number" && raw <= Number(r.value);
    case "is_true":
      return raw === true;
    case "is_false":
      return raw === false;
    case "contains":
      return Array.isArray(raw) && (raw as unknown[]).includes(r.value);
    case "not_contains":
      return !Array.isArray(raw) || !(raw as unknown[]).includes(r.value);
    case "older_than_days":
      return typeof raw === "string" && new Date(raw).getTime() < now.getTime() - Number(r.value) * 86_400_000;
    case "within_days":
      return typeof raw === "string" && new Date(raw).getTime() >= now.getTime() - Number(r.value) * 86_400_000;
    case "is_null":
      return raw === null || raw === undefined;
    case "is_not_null":
      return raw !== null && raw !== undefined;
  }
}

/**
 * A grade band on the facts view: both bounds must hold for the *same*
 * child, which the per-rule check above cannot say. This is the one rule
 * shape the post-filter exists for.
 */
export function gradeBandMatches(row: CrmFamilyFactsRow, rules: readonly Rule[]): boolean {
  const band = rules.filter((r) => r.field === "grade_sorts");
  if (band.length === 0) return true;
  const min = band.find((r) => r.op === "gte");
  const max = band.find((r) => r.op === "lte");
  return row.grade_sorts.some((s) => (!min || s >= Number(min.value)) && (!max || s <= Number(max.value)));
}

/** The examples from the brief, ready to save. */
export const SEGMENT_PRESETS: ReadonlyArray<{ key: string; name: string; description: string; rules: Rule[] }> = [
  { key: "active_families", name: "Active families", description: "A child attending.", rules: [{ field: "lifecycle_stage", op: "in", value: ["active", "reenrolment"] }] },
  { key: "multiple_children", name: "Families with more than one child", description: "Two or more children known to us.", rules: [{ field: "student_count", op: "gte", value: 2 }] },
  { key: "new_families", name: "New families", description: "Created in the last 30 days.", rules: [{ field: "created_at", op: "within_days", value: 30 }] },
  { key: "no_response_30d", name: "No contact in 30 days", description: "Active families nobody has written to in a month.", rules: [{ field: "is_active", op: "is_true" }, { field: "last_contact_at", op: "older_than_days", value: 30 }] },
  { key: "reenrolment_outstanding", name: "Re-enrolment outstanding", description: "An unanswered question in an open round.", rules: [{ field: "reenrolment_outstanding", op: "gte", value: 1 }] },
  { key: "robotics_prospects", name: "Robotics prospects", description: "Stage 4 to 7, not registered for robotics.", rules: [{ field: "grade_sorts", op: "gte", value: 90 }, { field: "grade_sorts", op: "lte", value: 120 }, { field: "registered_item_codes", op: "not_contains", value: "robotics" }] },
  { key: "swimming_prospects", name: "Swimming prospects", description: "Reception and up, not registered for swimming.", rules: [{ field: "grade_sorts", op: "gte", value: 50 }, { field: "registered_item_codes", op: "not_contains", value: "swimming" }] },
];

/** A rule in one line, for the segment list and the campaign preview. */
export function describeRule(r: Rule, lookups: { campus?: (id: string) => string; grade?: (id: string) => string; staff?: (id: string) => string } = {}): string {
  const field = ruleField(r.field);
  const label = field?.label ?? r.field;
  const val = (v: unknown): string => {
    if (Array.isArray(v)) return v.map(val).join(", ");
    const s = String(v);
    if (field?.kind === "campus" && lookups.campus) return lookups.campus(s);
    if (field?.kind === "grade" && lookups.grade) return lookups.grade(s);
    if (field?.kind === "staff" && lookups.staff) return lookups.staff(s);
    const opt = field?.options?.find((o) => o.value === s);
    return opt?.label ?? s;
  };
  switch (r.op) {
    case "is_true":
    case "is_false":
    case "is_null":
    case "is_not_null":
      return `${label} ${RULE_OP_LABELS[r.op]}`;
    case "older_than_days":
      return `${label} more than ${r.value} days ago`;
    case "within_days":
      return `${label} within the last ${r.value} days`;
    default:
      return `${label} ${RULE_OP_LABELS[r.op]} ${val(r.value)}`;
  }
}
