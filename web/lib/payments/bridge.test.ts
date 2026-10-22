import { describe, expect, it } from "vitest";
import { bridgeUrl } from "@/lib/payments/bridge";

describe("bridgeUrl", () => {
  it("keeps the applicant's pages where they were", () => {
    expect(bridgeUrl(undefined, "gateway", "ABC-123")).toBe("/pay/gateway?ref=ABC-123");
    expect(bridgeUrl(undefined, "dev", "HBS 1")).toBe("/pay/dev?ref=HBS%201");
  });

  it("puts a family's under the path its cookie is sent to", () => {
    expect(bridgeUrl("/family/extras/pay/1f0e-22", "gateway", "X")).toBe("/family/extras/pay/1f0e-22/gateway?ref=X");
  });

  it("refuses anything that is not a path on this site", () => {
    expect(() => bridgeUrl("https://elsewhere.example", "gateway", "X")).toThrow();
    expect(() => bridgeUrl("//elsewhere.example", "gateway", "X")).toThrow();
    expect(() => bridgeUrl("/pay/", "gateway", "X")).toThrow();
    expect(() => bridgeUrl("/pay?x=1", "gateway", "X")).toThrow();
  });
});
