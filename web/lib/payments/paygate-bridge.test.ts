import { describe, expect, it } from "vitest";
import { bridgePageHtml } from "@/lib/payments/paygate-bridge";

describe("bridgePageHtml", () => {
  it("posts the request id and checksum to PayGate, with the request's nonce on the script", () => {
    const html = bridgePageHtml({ action: "https://secure.paygate.co.za/payweb3/process.trans", payRequestId: "23B785AE", checksum: "abc123", nonce: "n0nce" });
    expect(html).toContain('<form method="post" action="https://secure.paygate.co.za/payweb3/process.trans" id="f">');
    expect(html).toContain('name="PAY_REQUEST_ID" value="23B785AE"');
    expect(html).toContain('name="CHECKSUM" value="abc123"');
    expect(html).toContain('<script nonce="n0nce">');
  });

  it("escapes what it is given", () => {
    const html = bridgePageHtml({ action: "x", payRequestId: '"><script>alert(1)</script>', checksum: "c", nonce: "" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("<script>document.getElementById");
  });
});
