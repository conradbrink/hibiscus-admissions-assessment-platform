import { describe, expect, it } from "vitest";
import { effectsFromForm, FIRST_MONTH_LABEL, unrepresentable } from "./effect-form";

/** SCHOLARSHIP-40 as production holds it — the list the form used to destroy. */
const SCHOLARSHIP_40 = [
  { kind: "waive_fee", fee_code: "registration", label: "Application fee waived" },
  { kind: "waive_fee", fee_code: "admission", label: "Admission fee waived" },
  { kind: "discount_percent", fee_code: "tuition_term", label: "Scholarship — 40% of tuition" },
  { kind: "discount_percent", fee_code: "tuition_annual", label: "Scholarship — 40% of the year's tuition" },
  { kind: "discount_percent", fee_code: "tuition_month", label: "Scholarship — 40% of the monthly fee" },
  { kind: "require_at_acceptance", fee_code: "tuition_month", label: FIRST_MONTH_LABEL },
] as const;

describe("effectsFromForm", () => {
  it("turns one tuition percentage into all three tuition lines", () => {
    // A campus bills by term, year or month, and the letter quotes whichever
    // it uses. Reducing one line and not the others would print a full-price
    // year beside a discounted term.
    const effects = effectsFromForm({ tuitionPercent: "40" });
    expect(effects.map((e) => e.fee_code)).toEqual(["tuition_term", "tuition_annual", "tuition_month"]);
    expect(effects.every((e) => e.percent === 40)).toBe(true);
    expect(effects.map((e) => e.label)).toEqual([
      "Scholarship — 40% of tuition",
      "Scholarship — 40% of the year's tuition",
      "Scholarship — 40% of the monthly fee",
    ]);
  });

  it("reproduces SCHOLARSHIP-40 exactly, so a save carries it forward unchanged", () => {
    // The point of the whole change: what the form builds for a 40% band must
    // match what production holds, or saving still loses something.
    const built = effectsFromForm({
      waiveRegistration: "1",
      waiveAdmission: "1",
      tuitionPercent: "40",
      firstMonthAtAcceptance: "1",
    });
    expect(built.map((e) => `${e.kind}:${e.fee_code}`)).toEqual(
      SCHOLARSHIP_40.map((e) => `${e.kind}:${e.fee_code}`)
    );
    expect(built.map((e) => e.label)).toEqual(SCHOLARSHIP_40.map((e) => e.label));
  });

  it("refuses the first-month rule without a scholarship", () => {
    // It is meaningless alone: there is no reduced monthly fee to require.
    expect(() => effectsFromForm({ firstMonthAtAcceptance: "1" })).toThrow(/only payable at acceptance on a scholarship/);
  });

  it("rejects a percentage outside 1 to 100", () => {
    expect(() => effectsFromForm({ tuitionPercent: "0" })).toThrow(/between 1 and 100/);
    expect(() => effectsFromForm({ tuitionPercent: "120" })).toThrow(/between 1 and 100/);
    expect(() => effectsFromForm({ tuitionPercent: "abc" })).toThrow(/between 1 and 100/);
  });

  it("takes a percentage written with a sign", () => {
    expect(effectsFromForm({ tuitionPercent: " 50% " })[0].percent).toBe(50);
  });

  it("still builds the old shapes", () => {
    const waivers = effectsFromForm({ waiveRegistration: "1", waiveAdmission: "1" });
    expect(waivers.map((e) => e.label)).toEqual(["Application fee waived", "Admission fee waived"]);
    const pct = effectsFromForm({ admissionDiscountKind: "percent", admissionDiscountValue: "10" });
    expect(pct[0]).toMatchObject({ kind: "discount_percent", fee_code: "admission", percent: 10 });
    const gifts = effectsFromForm({ gifts: "P1,000 uniform voucher\n\nHibiscus hat" });
    expect(gifts.map((e) => e.label)).toEqual(["P1,000 uniform voucher", "Hibiscus hat"]);
  });

  it("ignores an admission discount when the admission fee is waived", () => {
    const effects = effectsFromForm({ waiveAdmission: "1", admissionDiscountKind: "percent", admissionDiscountValue: "10" });
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe("waive_fee");
  });
});

describe("unrepresentable", () => {
  it("passes a scholarship, now that the form can build one", () => {
    // Before the tuition field existed this returned four labels, which is
    // exactly what a save was dropping on the floor.
    expect(unrepresentable(SCHOLARSHIP_40)).toEqual([]);
  });

  it("passes the shapes the form has always made", () => {
    expect(
      unrepresentable([
        { kind: "waive_fee", fee_code: "registration", label: "Application fee waived" },
        { kind: "discount_fixed", fee_code: "admission", label: "500 off the admission fee" },
        { kind: "gift", fee_code: null, label: "Hibiscus hat" },
      ])
    ).toEqual([]);
  });

  it("names an effect the form cannot rebuild, rather than letting it be deleted", () => {
    // The guard that outlives this change: the next effect kind added to the
    // schema without a field is refused here instead of vanishing on save.
    expect(
      unrepresentable([
        { kind: "waive_fee", fee_code: "registration", label: "Application fee waived" },
        { kind: "discount_percent", fee_code: "registration", label: "15% off the application fee" },
        { kind: "require_at_acceptance", fee_code: "tuition_term", label: "First term payable" },
      ])
    ).toEqual(["15% off the application fee", "First term payable"]);
  });
});
