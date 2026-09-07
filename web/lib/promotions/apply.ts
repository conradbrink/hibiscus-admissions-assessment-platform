import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { formatMoney } from "@/lib/money";
import type { EntryRoute, FeeCode, HeardFrom, PromotionEffectKind } from "@/lib/supabase/types";

/**
 * Promotions, the pure half: what a deal does to a fee snapshot, who
 * qualifies, and how the result reads in a letter. No database here, so
 * vitest covers the arithmetic. Applying a deal is idempotent on the
 * snapshot's `original_minor` values, so a re-draft never discounts twice.
 */

export type PromotionEffect = {
  kind: PromotionEffectKind;
  fee_code: FeeCode | null;
  amount_minor: number | null;
  percent: number | null;
  label: string;
};

export type PromotionSummary = {
  id: string;
  code: string | null;
  name: string;
  letter_text: string | null;
  effects: PromotionEffect[];
};

/** What the snapshot carries once a deal is applied: enough to print and to report, never the rule that chose it. */
export type AppliedPromotion = {
  id: string;
  code: string | null;
  name: string;
  letter_text: string | null;
  /** Gift lines in the order defined. */
  gifts: string[];
  /** Fee effects as they read: "Application fee waived", "Admission fee: 10% off". */
  fee_lines: string[];
  savings_minor: number;
};

export type PromotionFeeSnapshot = FeeSnapshot & { promotion?: AppliedPromotion | null };

/** Codes are typed by parents: trim, uppercase, letters, digits and hyphens only. */
export function normaliseCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{3,24}$/.test(code) ? code : null;
}

/** The deal applied to the schedule's lines. Returns a new snapshot; the input is not changed. */
export function applyPromotion(snapshot: FeeSnapshot, promo: PromotionSummary): PromotionFeeSnapshot {
  const lines = snapshot.lines.map((l) => {
    const original = (l as { original_minor?: number }).original_minor ?? l.amount_minor;
    return { ...l, amount_minor: original, original_minor: original, waived: false };
  });
  const gifts: string[] = [];
  const feeLines: string[] = [];
  for (const e of promo.effects) {
    if (e.kind === "gift") {
      gifts.push(e.label);
      continue;
    }
    const line = lines.find((l) => l.code === e.fee_code);
    if (!line) continue;
    if (e.kind === "waive_fee") {
      line.amount_minor = 0;
      line.waived = true;
    } else if (e.kind === "discount_fixed") {
      line.amount_minor = Math.max(0, line.amount_minor - Math.max(0, Math.round(e.amount_minor ?? 0)));
      line.waived = line.amount_minor === 0;
    } else if (e.kind === "discount_percent") {
      const pct = Math.min(100, Math.max(0, e.percent ?? 0));
      line.amount_minor = Math.max(0, Math.round(line.amount_minor * (1 - pct / 100)));
      line.waived = line.amount_minor === 0;
    }
    feeLines.push(e.label);
  }
  let total = 0;
  let payable = 0;
  let savings = 0;
  for (const l of lines) {
    total += l.amount_minor;
    if (l.payable_at_acceptance) payable += l.amount_minor;
    savings += (l.original_minor ?? l.amount_minor) - l.amount_minor;
  }
  return {
    currency: snapshot.currency,
    lines,
    total_minor: total,
    payable_at_acceptance_minor: payable,
    promotion: { id: promo.id, code: promo.code, name: promo.name, letter_text: promo.letter_text, gifts, fee_lines: feeLines, savings_minor: savings },
  };
}

export type EligibilityContext = {
  campusId: string;
  academicYearId: string;
  gradeSort: number;
  entryRoute: EntryRoute;
  heardFrom: HeardFrom | null;
  /** YYYY-MM-DD, the school's date. */
  today: string;
  /** The code the parent typed, normalised, or null. */
  code: string | null;
  /** Applications already carrying the deal. */
  redemptions: number;
};

export type PromotionRule = {
  id: string;
  code: string | null;
  is_active: boolean;
  campus_id: string | null;
  academic_year_id: string | null;
  grade_sort_min: number | null;
  grade_sort_max: number | null;
  entry_route: EntryRoute | null;
  heard_from: HeardFrom | null;
  starts_on: string | null;
  ends_on: string | null;
  max_redemptions: number | null;
};

export type Eligibility = { ok: true } | { ok: false; reason: "inactive" | "code" | "campus" | "year" | "grade" | "route" | "heard_from" | "window" | "redemptions" };

/**
 * Whether a deal applies to an application. A coded deal needs the code;
 * a deal without a code applies by its rules alone.
 */
export function promotionMatches(promo: PromotionRule, ctx: EligibilityContext): Eligibility {
  if (!promo.is_active) return { ok: false, reason: "inactive" };
  if (promo.code && promo.code !== ctx.code) return { ok: false, reason: "code" };
  if (promo.campus_id && promo.campus_id !== ctx.campusId) return { ok: false, reason: "campus" };
  if (promo.academic_year_id && promo.academic_year_id !== ctx.academicYearId) return { ok: false, reason: "year" };
  if (promo.grade_sort_min !== null && ctx.gradeSort < promo.grade_sort_min) return { ok: false, reason: "grade" };
  if (promo.grade_sort_max !== null && ctx.gradeSort > promo.grade_sort_max) return { ok: false, reason: "grade" };
  if (promo.entry_route && promo.entry_route !== ctx.entryRoute) return { ok: false, reason: "route" };
  if (promo.heard_from && promo.heard_from !== ctx.heardFrom) return { ok: false, reason: "heard_from" };
  if (promo.starts_on && ctx.today < promo.starts_on) return { ok: false, reason: "window" };
  if (promo.ends_on && ctx.today > promo.ends_on) return { ok: false, reason: "window" };
  if (promo.max_redemptions !== null && ctx.redemptions >= promo.max_redemptions) return { ok: false, reason: "redemptions" };
  return { ok: true };
}

/** The first rule-based deal that applies, in the order given (oldest first is the caller's choice). */
export function pickRulePromotion<T extends PromotionRule>(promos: T[], ctx: EligibilityContext): T | null {
  return promos.find((p) => !p.code && promotionMatches(p, ctx).ok) ?? null;
}

/** "Application fee waived · P1,000 uniform voucher · Hibiscus hat and T-shirt" */
export function promotionLines(applied: AppliedPromotion): string {
  return [...applied.fee_lines, ...applied.gifts].join(" · ");
}

/** The letter and email variables for an applied deal, or nulls when none. */
export function promotionVariables(snapshot: FeeSnapshot | null): {
  promotion_name: string | null;
  promotion_lines: string | null;
  promotion_text: string | null;
  promotion_savings: string | null;
} {
  const applied = (snapshot as PromotionFeeSnapshot | null)?.promotion ?? null;
  if (!applied || !snapshot) return { promotion_name: null, promotion_lines: null, promotion_text: null, promotion_savings: null };
  return {
    promotion_name: applied.name,
    promotion_lines: promotionLines(applied) || null,
    promotion_text: applied.letter_text || null,
    promotion_savings: applied.savings_minor > 0 ? formatMoney(applied.savings_minor, snapshot.currency) : null,
  };
}

/** True when a deal has been applied and nothing is left to pay on acceptance. */
export function fullyWaived(snapshot: FeeSnapshot | null): boolean {
  const s = snapshot as PromotionFeeSnapshot | null;
  return !!s && !!s.promotion && s.payable_at_acceptance_minor === 0 && s.lines.some((l) => l.payable_at_acceptance && (l.original_minor ?? 0) > 0);
}
