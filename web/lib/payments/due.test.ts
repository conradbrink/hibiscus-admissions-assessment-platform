import { describe, expect, it } from "vitest";
import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { chargeAtAcceptance, securedWithoutPaying } from "./due";

const snapshot = (over: Partial<FeeSnapshot> & { lines?: FeeSnapshot["lines"] } = {}): FeeSnapshot => ({
  currency: "BWP",
  lines: [],
  total_minor: 0,
  payable_at_acceptance_minor: 0,
  ...over,
});

describe("chargeAtAcceptance", () => {
  it("asks for the money when there is money to ask for", () => {
    const c = chargeAtAcceptance(
      snapshot({
        lines: [{ code: "registration", label: "Application fee", amount_minor: 30000, payable_at_acceptance: true }],
        total_minor: 30000,
        payable_at_acceptance_minor: 30000,
      })
    );
    expect(c).toEqual({ kind: "payable", amountMinor: 30000 });
    expect(securedWithoutPaying(c)).toBe(false);
  });

  it("charges nothing at a campus that charges nothing", () => {
    // Bana Tlokweng: real fees on the schedule, none of them due to secure
    // the place. This used to throw, after the acceptance had been written.
    const c = chargeAtAcceptance(
      snapshot({
        lines: [
          { code: "tuition_month", label: "Monthly fees", amount_minor: 159000, payable_at_acceptance: false },
          { code: "stationery_annual", label: "Annual stationery", amount_minor: 185000, payable_at_acceptance: false },
        ],
        total_minor: 344000,
      })
    );
    expect(c.kind).toBe("none");
    expect(securedWithoutPaying(c)).toBe(true);
  });

  it("still tells a waived deal apart from a campus that never charged", () => {
    // The distinction matters: one says "we waived your fee" to a parent who
    // expected to pay, the other must not.
    const waived = chargeAtAcceptance(
      snapshot({
        lines: [{ code: "registration", label: "Application fee", amount_minor: 0, payable_at_acceptance: true, original_minor: 30000, waived: true }],
        promotion: { name: "Welcome 2027" },
      } as Partial<FeeSnapshot>)
    );
    expect(waived).toEqual({ kind: "waived", reason: "Welcome 2027" });
  });

  it("is an error only when the offer was never priced", () => {
    const c = chargeAtAcceptance(null);
    expect(c).toEqual({ kind: "unpriced" });
    expect(securedWithoutPaying(c)).toBe(false);
  });

  it("treats a priced offer with no lines as charging nothing, not as unpriced", () => {
    // onOfferDrafted refuses to price an empty schedule, so this shape should
    // not arise — but if it ever does, it is not the parent's problem to hit.
    expect(chargeAtAcceptance(snapshot()).kind).toBe("none");
  });
});
