import { describe, expect, it } from "vitest";
import { canPayOnline, GATEWAY_CURRENCIES, transferOnlyReason } from "@/lib/payments/online";

describe("which currencies the gateway can take", () => {
  it("takes Pula on the school's Botswana gateway", () => {
    expect(canPayOnline("paygate", "BWP")).toBe(true);
  });

  it("refuses Rand on the Botswana gateway — the bug this exists for", () => {
    // Potchefstroom charges in Rand and no South African gateway is arranged.
    // Offering the card button there sends a family to a page that cannot
    // take their money.
    expect(canPayOnline("paygate", "ZAR")).toBe(false);
    expect(canPayOnline("dpo", "ZAR")).toBe(false);
  });

  it("takes both in development, where nothing is charged", () => {
    expect(canPayOnline("dev", "BWP")).toBe(true);
    expect(canPayOnline("dev", "ZAR")).toBe(true);
  });

  it("refuses a currency no gateway has ever heard of", () => {
    expect(canPayOnline("paygate", "USD")).toBe(false);
    expect(canPayOnline("dev", "GBP")).toBe(false);
  });

  it("lists a currency only where money would actually arrive", () => {
    // A currency in this map is a claim that a payment settles. Adding one
    // without an account is how a family pays into nothing.
    for (const [provider, currencies] of Object.entries(GATEWAY_CURRENCIES)) {
      expect(currencies.length, `${provider} takes nothing`).toBeGreaterThan(0);
      for (const c of currencies) expect(["BWP", "ZAR"]).toContain(c);
    }
  });
});

describe("what the family is told", () => {
  it("names the currency and does not name the gateway", () => {
    const said = transferOnlyReason("ZAR");
    expect(said).toContain("ZAR");
    expect(said).toContain("bank transfer");
    expect(said.toLowerCase()).not.toContain("paygate");
  });
});
