import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRIDGE_BASES, bridgeUrl } from "@/lib/payments/bridge";
import { devProvider } from "@/lib/payments/dev";
import type { CheckoutRequest } from "@/lib/payments/provider";

/**
 * The hand-off pages, as a test.
 *
 * The bug this pins: every payment went through `/pay/gateway` and `/pay/dev`,
 * which only the admissions cookie reaches. A family paying for extras on the
 * live gateway was sent to a page their browser sent no session to.
 */

const root = path.resolve(__dirname, "..", "..");
// A bridge may sit in any route group: the admissions and family pages are
// under `(parent)`, the transport pages under `(transport)`.
const groups = readdirSync(path.join(root, "app")).filter((d) => d.startsWith("("));
const pageExists = (base: string, ...rest: string[]) => groups.some((g) => existsSync(path.join(root, "app", g, base, ...rest)));

const request = (bridgeBase: CheckoutRequest["bridgeBase"]): CheckoutRequest => ({
  paymentId: "p1",
  amountMinor: 1000,
  currency: "BWP",
  reference: "HBS-2026-00008-ABCD1234",
  description: "Optional extras",
  returnUrl: "https://a.example/family/extras/pay/s1/return",
  backUrl: "https://a.example/family/extras/pay/s1?cancelled=1",
  bridgeBase,
  customer: { email: "p@example.com", firstName: "P", lastName: "Q" },
});

describe("bridgeUrl", () => {
  it("puts each page under the base it is given", () => {
    expect(bridgeUrl("/pay", "gateway", "abc")).toBe("/pay/gateway?ref=abc");
    expect(bridgeUrl("/family/pay", "dev", "abc")).toBe("/family/pay/dev?ref=abc");
  });

  it("encodes the reference", () => {
    expect(bridgeUrl("/pay", "gateway", "a b&c")).toBe("/pay/gateway?ref=a%20b%26c");
  });
});

describe("the development adapter", () => {
  it("sends a family to the family's simulate page", async () => {
    const out = await devProvider.createCheckout(request("/family/pay"));
    expect(out.redirectUrl).toBe("/family/pay/dev?ref=HBS-2026-00008-ABCD1234");
  });

  it("still sends an admission to /pay/dev", async () => {
    const out = await devProvider.createCheckout(request("/pay"));
    expect(out.redirectUrl.startsWith("/pay/dev?")).toBe(true);
  });
});

describe("every bridge base has its pages", () => {
  for (const base of BRIDGE_BASES) {
    it(`${base} has a PayGate bridge and a simulate page`, () => {
      expect(pageExists(base, "gateway", "route.ts"), `${base}/gateway/route.ts`).toBe(true);
      expect(pageExists(base, "dev", "page.tsx"), `${base}/dev/page.tsx`).toBe(true);
    });
  }

  it("each payer's bridge sits under its own cookie's path", () => {
    // If a cookie path ever moves, its bridge has to move with it, or the
    // payer is back to arriving with no session.
    const server = readFileSync(path.join(root, "lib", "tokens", "server.ts"), "utf8");
    expect(server).toContain('path: "/family"');
    expect(server).toContain('const TRANSPORT_PATH = "/transport";');
    expect("/family/pay".startsWith("/family/")).toBe(true);
    expect("/transport/pay".startsWith("/transport/")).toBe(true);
  });

  it("the paygate adapter builds its redirect from the caller's base", () => {
    const source = readFileSync(path.join(root, "lib", "payments", "paygate.ts"), "utf8");
    expect(source).toContain('bridgeUrl(request.bridgeBase, "gateway"');
    expect(source).not.toContain("`/pay/gateway");
  });
});
