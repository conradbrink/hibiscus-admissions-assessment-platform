/**
 * The effects the Promotions form can express, and the ones it cannot.
 *
 * `savePromotion` replaces a promotion's effects as a set: it deletes every
 * row and re-inserts what the form produced. That is the right shape — an
 * effect list is a whole, and a deal already on an application keeps the
 * letter it was drafted with, because the snapshot lives on the offer.
 *
 * It is only safe while the form can express everything an effect list might
 * hold, and for a long time it could not. The scholarship bands carry a
 * percentage off each of the three tuition lines and a rule making the first
 * month payable at acceptance; the form offered waivers, an admission-fee
 * discount and gifts. So opening `SCHOLARSHIP-40` and pressing Save — to
 * switch it off, or fix a typo in the name — deleted four of its six effects
 * and left "both fees waived, full tuition payable", silently, for every
 * family who held it.
 *
 * Two things fix that and both live here, because they have to agree:
 * `effectsFromForm` says what the form can build, and `unrepresentable` says
 * what it would destroy. The second is the one that survives the next effect
 * kind somebody adds to the schema and forgets to add a field for.
 */

import { parseMoneyToMinor } from "@/lib/money";
import type { PromotionEffectRow } from "@/lib/supabase/types";

export type Effect = Omit<PromotionEffectRow, "id" | "promotion_id">;

/** The three lines a tuition scholarship reduces, with the parent's wording. */
const TUITION_LINES = [
  { fee_code: "tuition_term", label: (p: number) => `Scholarship — ${p}% of tuition` },
  { fee_code: "tuition_annual", label: (p: number) => `Scholarship — ${p}% of the year's tuition` },
  { fee_code: "tuition_month", label: (p: number) => `Scholarship — ${p}% of the monthly fee` },
] as const;

/** The wording the first-month rule has carried since it was introduced. */
export const FIRST_MONTH_LABEL = "First month payable to confirm the place";

export type EffectFormInput = {
  waiveRegistration?: string;
  waiveAdmission?: string;
  admissionDiscountKind?: "none" | "fixed" | "percent";
  admissionDiscountValue?: string;
  tuitionPercent?: string;
  firstMonthAtAcceptance?: string;
  gifts?: string;
};

function percentOrThrow(raw: string, what: string): number {
  const pct = Number(raw.replace(/%/g, "").trim());
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error(`Enter ${what} as a percentage between 1 and 100.`);
  return Math.round(pct * 100) / 100;
}

export function effectsFromForm(p: EffectFormInput): Effect[] {
  const out: Effect[] = [];
  let position = 1;
  const push = (e: Omit<Effect, "position">) => out.push({ ...e, position: position++ });

  if (p.waiveRegistration === "1") push({ kind: "waive_fee", fee_code: "registration", amount_minor: null, percent: null, label: "Application fee waived" });
  if (p.waiveAdmission === "1") push({ kind: "waive_fee", fee_code: "admission", amount_minor: null, percent: null, label: "Admission fee waived" });
  if (p.waiveAdmission !== "1" && p.admissionDiscountKind && p.admissionDiscountKind !== "none") {
    const raw = p.admissionDiscountValue ?? "";
    if (p.admissionDiscountKind === "fixed") {
      const minor = parseMoneyToMinor(raw);
      if (minor === null || minor <= 0) throw new Error("Enter the admission fee discount as an amount, for example 500.");
      push({ kind: "discount_fixed", fee_code: "admission", amount_minor: minor, percent: null, label: `${(minor / 100).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} off the admission fee` });
    } else {
      const pct = percentOrThrow(raw, "the admission fee discount");
      push({ kind: "discount_percent", fee_code: "admission", amount_minor: null, percent: pct, label: `${pct}% off the admission fee` });
    }
  }

  // One percentage, three lines. A letter quotes whichever of term, year and
  // month its campus bills on, so a band that reduced only one of them would
  // read as a full-price year beside a discounted term.
  const tuitionRaw = (p.tuitionPercent ?? "").trim();
  if (tuitionRaw !== "") {
    const pct = percentOrThrow(tuitionRaw, "the tuition scholarship");
    for (const line of TUITION_LINES) {
      push({ kind: "discount_percent", fee_code: line.fee_code, amount_minor: null, percent: pct, label: line.label(pct) });
    }
    if (p.firstMonthAtAcceptance === "1") {
      push({ kind: "require_at_acceptance", fee_code: "tuition_month", amount_minor: null, percent: null, label: FIRST_MONTH_LABEL });
    }
  } else if (p.firstMonthAtAcceptance === "1") {
    throw new Error("The first month is only payable at acceptance on a scholarship. Set a tuition percentage, or clear that box.");
  }

  for (const line of (p.gifts ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (line.length > 120) throw new Error("Keep each gift to one short line.");
    push({ kind: "gift", fee_code: null, amount_minor: null, percent: null, label: line });
  }
  return out;
}

/** Every `kind:fee_code` pair the form above can produce. */
const REPRESENTABLE = new Set<string>([
  "waive_fee:registration",
  "waive_fee:admission",
  "discount_fixed:admission",
  "discount_percent:admission",
  "discount_percent:tuition_term",
  "discount_percent:tuition_annual",
  "discount_percent:tuition_month",
  "require_at_acceptance:tuition_month",
  "gift:",
]);

/**
 * The labels of any stored effects this form would throw away.
 *
 * Checked against what is already on the promotion, before the delete — so a
 * save that cannot carry an effect forward is refused rather than quietly
 * dropping it. Empty means the form holds everything and replacing the set is
 * lossless.
 */
export function unrepresentable(existing: readonly Pick<PromotionEffectRow, "kind" | "fee_code" | "label">[]): string[] {
  return existing.filter((e) => !REPRESENTABLE.has(`${e.kind}:${e.fee_code ?? ""}`)).map((e) => e.label);
}
