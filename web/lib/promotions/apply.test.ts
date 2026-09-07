import { describe, expect, it } from "vitest";
import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { applyPromotion, fullyWaived, normaliseCode, pickRulePromotion, promotionMatches, promotionVariables, type PromotionRule, type PromotionSummary } from "@/lib/promotions/apply";

const snapshot: FeeSnapshot = {
  currency: "BWP",
  lines: [
    { code: "registration", label: "Application fee", amount_minor: 30000, payable_at_acceptance: true },
    { code: "admission", label: "Admission fee", amount_minor: 500000, payable_at_acceptance: true },
    { code: "tuition_term", label: "Tuition per term", amount_minor: 1899000, payable_at_acceptance: false },
  ],
  total_minor: 2429000,
  payable_at_acceptance_minor: 530000,
};

const launch: PromotionSummary = {
  id: "p1",
  code: "LAUNCH27",
  name: "Launch 2027",
  letter_text: "Welcome to the Hibiscus family.",
  effects: [
    { kind: "waive_fee", fee_code: "registration", amount_minor: null, percent: null, label: "Application fee waived" },
    { kind: "gift", fee_code: null, amount_minor: null, percent: null, label: "P1,000 uniform voucher" },
    { kind: "gift", fee_code: null, amount_minor: null, percent: null, label: "Hibiscus hat and T-shirt" },
  ],
};

describe("applyPromotion", () => {
  it("waives a line, keeps the original, and recomputes the totals", () => {
    const out = applyPromotion(snapshot, launch);
    const reg = out.lines.find((l) => l.code === "registration")!;
    expect(reg.amount_minor).toBe(0);
    expect(reg.original_minor).toBe(30000);
    expect(reg.waived).toBe(true);
    expect(out.payable_at_acceptance_minor).toBe(500000);
    expect(out.total_minor).toBe(2399000);
    expect(out.promotion?.gifts).toEqual(["P1,000 uniform voucher", "Hibiscus hat and T-shirt"]);
    expect(out.promotion?.fee_lines).toEqual(["Application fee waived"]);
    expect(out.promotion?.savings_minor).toBe(30000);
    expect(snapshot.lines[0].amount_minor).toBe(30000);
  });

  it("discounts by amount and by percentage, never below zero", () => {
    const out = applyPromotion(snapshot, {
      ...launch,
      effects: [
        { kind: "discount_percent", fee_code: "admission", amount_minor: null, percent: 10, label: "10% off the admission fee" },
        { kind: "discount_fixed", fee_code: "registration", amount_minor: 100000, percent: null, label: "Application fee reduced" },
      ],
    });
    expect(out.lines.find((l) => l.code === "admission")!.amount_minor).toBe(450000);
    expect(out.lines.find((l) => l.code === "registration")!.amount_minor).toBe(0);
    expect(out.payable_at_acceptance_minor).toBe(450000);
    expect(out.promotion?.savings_minor).toBe(80000);
  });

  it("is idempotent on a re-draft", () => {
    const twice = applyPromotion(applyPromotion(snapshot, launch), launch);
    expect(twice.payable_at_acceptance_minor).toBe(500000);
    expect(twice.promotion?.savings_minor).toBe(30000);
  });

  it("knows when nothing is left to pay", () => {
    const all = applyPromotion(snapshot, {
      ...launch,
      effects: [
        { kind: "waive_fee", fee_code: "registration", amount_minor: null, percent: null, label: "Application fee waived" },
        { kind: "waive_fee", fee_code: "admission", amount_minor: null, percent: null, label: "Admission fee waived" },
      ],
    });
    expect(fullyWaived(all)).toBe(true);
    expect(fullyWaived(applyPromotion(snapshot, launch))).toBe(false);
    expect(fullyWaived(snapshot)).toBe(false);
  });

  it("builds the letter variables", () => {
    const v = promotionVariables(applyPromotion(snapshot, launch));
    expect(v.promotion_name).toBe("Launch 2027");
    expect(v.promotion_lines).toBe("Application fee waived · P1,000 uniform voucher · Hibiscus hat and T-shirt");
    expect(v.promotion_savings).toBe("P 300.00");
    expect(promotionVariables(snapshot).promotion_name).toBeNull();
  });
});

describe("eligibility", () => {
  const rule: PromotionRule = { id: "r", code: null, is_active: true, campus_id: null, academic_year_id: null, grade_sort_min: 10, grade_sort_max: 14, entry_route: null, heard_from: "social_media", starts_on: "2026-10-01", ends_on: "2026-11-30", max_redemptions: 50 };
  const ctx = { campusId: "c", academicYearId: "y", gradeSort: 12, entryRoute: "assessment" as const, heardFrom: "social_media" as const, today: "2026-10-15", code: null, redemptions: 3 };

  it("matches by rule when every condition holds", () => {
    expect(promotionMatches(rule, ctx)).toEqual({ ok: true });
  });
  it("names the first condition that fails", () => {
    expect(promotionMatches(rule, { ...ctx, today: "2026-12-01" })).toEqual({ ok: false, reason: "window" });
    expect(promotionMatches(rule, { ...ctx, gradeSort: 3 })).toEqual({ ok: false, reason: "grade" });
    expect(promotionMatches(rule, { ...ctx, heardFrom: "search" })).toEqual({ ok: false, reason: "heard_from" });
    expect(promotionMatches(rule, { ...ctx, redemptions: 50 })).toEqual({ ok: false, reason: "redemptions" });
    expect(promotionMatches({ ...rule, is_active: false }, ctx)).toEqual({ ok: false, reason: "inactive" });
  });
  it("a coded deal needs its code", () => {
    const coded = { ...rule, code: "LAUNCH27" };
    expect(promotionMatches(coded, ctx)).toEqual({ ok: false, reason: "code" });
    expect(promotionMatches(coded, { ...ctx, code: "LAUNCH27" })).toEqual({ ok: true });
    expect(pickRulePromotion([coded, rule], ctx)?.id).toBe("r");
  });
  it("normalises typed codes", () => {
    expect(normaliseCode(" launch 27 ")).toBe("LAUNCH27");
    expect(normaliseCode("ab")).toBeNull();
    expect(normaliseCode("bad code!")).toBeNull();
    expect(normaliseCode(null)).toBeNull();
  });
});
