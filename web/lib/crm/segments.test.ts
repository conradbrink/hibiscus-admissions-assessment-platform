import { describe, expect, it } from "vitest";
import { SEGMENT_PRESETS, applyRules, describeRule, gradeBandMatches, matchesRules, needsPostFilter, validateRules, type Rule } from "@/lib/crm/segments";
import type { CrmFamilyFactsRow } from "@/lib/supabase/types";

const NOW = new Date("2026-09-19T08:00:00Z");

function facts(over: Partial<CrmFamilyFactsRow> = {}): CrmFamilyFactsRow {
  return {
    family_id: "f1",
    family_code: "HBS-0001",
    display_name: "Brink",
    campus_id: "c1",
    campus_name: "Gaborone",
    lifecycle_stage: "active",
    lifecycle_manual: false,
    assigned_staff_id: null,
    lead_source: "referral",
    tags: ["vip"],
    preferred_channel: "email",
    last_contact_at: "2026-09-01T00:00:00Z",
    next_follow_up_at: null,
    created_at: "2026-01-01T00:00:00Z",
    is_active: true,
    referred_by_family_id: null,
    primary_contact_id: "p1",
    primary_first_name: "Anna",
    primary_last_name: "Brink",
    primary_email: "anna@example.com",
    primary_mobile: "71234567",
    primary_mobile_normalised: "+26771234567",
    primary_whatsapp_opt_in: true,
    primary_marketing_email_consent: true,
    primary_marketing_whatsapp_consent: false,
    primary_sms_consent: false,
    student_count: 2,
    enrolled_count: 1,
    grade_sorts: [60, 120],
    grade_ids: ["g1", "g7"],
    student_campus_ids: ["c1"],
    student_ids: ["s1", "s2"],
    student_statuses: ["active", "left"],
    registered_item_codes: ["swimming"],
    open_opportunity_types: ["robotics"],
    open_opportunity_count: 1,
    reenrolment_outstanding: 0,
    application_count: 2,
    open_application_count: 0,
    latest_application_status: "enrolled",
    ...over,
  } as CrmFamilyFactsRow;
}

describe("validateRules", () => {
  it("accepts the presets", () => {
    for (const p of SEGMENT_PRESETS) {
      const v = validateRules(p.rules);
      expect(v.ok, p.key).toBe(true);
    }
  });
  it("refuses an unknown field, a wrong operator, a wrong value shape", () => {
    const v = validateRules([
      { field: "shoe_size", op: "eq", value: 3 },
      { field: "lifecycle_stage", op: "older_than_days", value: 3 },
      { field: "student_count", op: "gte", value: "many" },
      { field: "campus_id", op: "in", value: [] },
      { field: "tags", op: "contains", value: "" },
    ]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
  });
  it("refuses something that is not a list at all", () => {
    expect(validateRules("x").ok).toBe(false);
    expect(validateRules(null).ok).toBe(false);
  });
  it("coerces numbers and drops values from operators that take none", () => {
    const v = validateRules([{ field: "student_count", op: "gte", value: "2" }, { field: "is_active", op: "is_true", value: "ignored" }, { field: "tags", op: "contains", value: "  vip " }]);
    expect(v).toEqual({ ok: true, rules: [{ field: "student_count", op: "gte", value: 2 }, { field: "is_active", op: "is_true" }, { field: "tags", op: "contains", value: "vip" }] });
  });
});

describe("matchesRules", () => {
  it("matches each operator over one row", () => {
    const row = facts();
    const yes = (r: Rule) => expect(matchesRules(row, [r], NOW), JSON.stringify(r)).toBe(true);
    const no = (r: Rule) => expect(matchesRules(row, [r], NOW), JSON.stringify(r)).toBe(false);
    yes({ field: "campus_id", op: "eq", value: "c1" });
    no({ field: "campus_id", op: "neq", value: "c1" });
    yes({ field: "lifecycle_stage", op: "in", value: ["active", "reenrolment"] });
    no({ field: "lifecycle_stage", op: "not_in", value: ["active"] });
    yes({ field: "student_count", op: "gte", value: 2 });
    no({ field: "student_count", op: "lte", value: 1 });
    yes({ field: "is_active", op: "is_true" });
    no({ field: "is_active", op: "is_false" });
    yes({ field: "tags", op: "contains", value: "vip" });
    no({ field: "tags", op: "not_contains", value: "vip" });
    yes({ field: "registered_item_codes", op: "not_contains", value: "robotics" });
    yes({ field: "student_statuses", op: "contains", value: "left" });
    yes({ field: "last_contact_at", op: "older_than_days", value: 7 });
    no({ field: "last_contact_at", op: "within_days", value: 7 });
    yes({ field: "last_contact_at", op: "within_days", value: 30 });
    yes({ field: "next_follow_up_at", op: "is_null" });
    yes({ field: "assigned_staff_id", op: "is_null" });
    no({ field: "assigned_staff_id", op: "is_not_null" });
    yes({ field: "primary_marketing_email_consent", op: "is_true" });
    yes({ field: "primary_marketing_whatsapp_consent", op: "is_false" });
  });
  it("a null consent is not false: nobody to ask is not a no", () => {
    expect(matchesRules(facts({ primary_marketing_email_consent: null }), [{ field: "primary_marketing_email_consent", op: "is_false" }])).toBe(false);
  });
  it("every rule must hold", () => {
    expect(matchesRules(facts(), [{ field: "campus_id", op: "eq", value: "c1" }, { field: "student_count", op: "gte", value: 3 }])).toBe(false);
  });
});

describe("gradeBandMatches", () => {
  it("needs one child inside both bounds, not one child per bound", () => {
    const band: Rule[] = [{ field: "grade_sorts", op: "gte", value: 90 }, { field: "grade_sorts", op: "lte", value: 100 }];
    expect(gradeBandMatches(facts({ grade_sorts: [60, 120] }), band)).toBe(false);
    expect(gradeBandMatches(facts({ grade_sorts: [60, 95] }), band)).toBe(true);
    expect(gradeBandMatches(facts({ grade_sorts: [] }), band)).toBe(false);
    expect(gradeBandMatches(facts({ grade_sorts: [] }), [])).toBe(true);
  });
  it("is the post-filter the query cannot do", () => {
    expect(needsPostFilter([{ field: "grade_sorts", op: "gte", value: 1 }])).toBe(true);
    expect(needsPostFilter([{ field: "campus_id", op: "eq", value: "c1" }])).toBe(false);
  });
});

describe("applyRules", () => {
  type Call = [string, ...unknown[]];
  function recorder() {
    const calls: Call[] = [];
    const q = {
      eq: (...a: unknown[]) => (calls.push(["eq", ...a]), q),
      neq: (...a: unknown[]) => (calls.push(["neq", ...a]), q),
      in: (...a: unknown[]) => (calls.push(["in", ...a]), q),
      not: (...a: unknown[]) => (calls.push(["not", ...a]), q),
      gte: (...a: unknown[]) => (calls.push(["gte", ...a]), q),
      lte: (...a: unknown[]) => (calls.push(["lte", ...a]), q),
      lt: (...a: unknown[]) => (calls.push(["lt", ...a]), q),
      is: (...a: unknown[]) => (calls.push(["is", ...a]), q),
      contains: (...a: unknown[]) => (calls.push(["contains", ...a]), q),
      or: (...a: unknown[]) => (calls.push(["or", ...a]), q),
    };
    return { q, calls };
  }
  it("turns rules into the PostgREST filters and skips the post-filtered ones", () => {
    const { q, calls } = recorder();
    applyRules(
      q,
      [
        { field: "campus_id", op: "in", value: ["c1", "c2"] },
        { field: "lifecycle_stage", op: "not_in", value: ["inactive"] },
        { field: "tags", op: "contains", value: "vip" },
        { field: "tags", op: "not_contains", value: "vip" },
        { field: "grade_sorts", op: "gte", value: 90 },
        { field: "last_contact_at", op: "older_than_days", value: 30 },
        { field: "assigned_staff_id", op: "is_not_null" },
        { field: "shoe_size", op: "eq", value: 1 } as Rule,
      ],
      NOW
    );
    expect(calls).toEqual([
      ["in", "campus_id", ["c1", "c2"]],
      ["not", "lifecycle_stage", "in", '("inactive")'],
      ["contains", "tags", ["vip"]],
      ["not", "tags", "cs", '{"vip"}'],
      ["lt", "last_contact_at", new Date(NOW.getTime() - 30 * 86_400_000).toISOString()],
      ["not", "assigned_staff_id", "is", null],
    ]);
  });
  it("never applies contains to a scalar field", () => {
    const { q, calls } = recorder();
    applyRules(q, [{ field: "lifecycle_stage", op: "contains", value: "x" } as Rule], NOW);
    expect(calls).toEqual([]);
  });
});

describe("describeRule", () => {
  it("reads as a sentence, with lookups where it has them", () => {
    expect(describeRule({ field: "campus_id", op: "eq", value: "c1" }, { campus: () => "Gaborone" })).toContain("Gaborone");
    expect(describeRule({ field: "last_contact_at", op: "older_than_days", value: 30 })).toMatch(/30 days/);
    expect(describeRule({ field: "is_active", op: "is_true" })).toMatch(/Active family/);
  });
});
