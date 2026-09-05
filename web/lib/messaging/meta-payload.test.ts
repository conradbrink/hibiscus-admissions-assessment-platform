import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildTemplatePayload,
  isOptIn,
  isOptOut,
  parseSendError,
  parseSendResponse,
  parseWebhook,
  placeholderCount,
  renderPreview,
  sanitiseParam,
  verifySignature,
} from "@/lib/messaging/meta-payload";

describe("sanitiseParam", () => {
  it("removes line breaks and tabs, which Meta rejects", () => {
    expect(sanitiseParam("Hibiscus Schools\nFNB\nAccount 123")).toBe("Hibiscus Schools, FNB, Account 123");
    expect(sanitiseParam("a\tb")).toBe("a b");
  });
  it("collapses four or more spaces", () => {
    expect(sanitiseParam("a      b")).toBe("a   b");
  });
  it("caps the length", () => {
    expect(sanitiseParam("x".repeat(2000)).length).toBe(1024);
  });
  it("renders null as empty", () => {
    expect(sanitiseParam(null)).toBe("");
  });
});

describe("buildTemplatePayload", () => {
  it("builds the Cloud API template body with positional parameters and a URL button", () => {
    const payload = buildTemplatePayload({
      to: "+26771234567",
      templateName: "booking_confirmed",
      language: "en",
      bodyParams: ["Sarah", "John"],
      buttonUrlSuffix: "abc123",
      idempotencyKey: "k",
    });
    expect(payload).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "26771234567",
      type: "template",
      template: {
        name: "booking_confirmed",
        language: { code: "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Sarah" }, { type: "text", text: "John" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc123" }] },
        ],
      },
    });
  });
  it("omits components when there is nothing to fill", () => {
    const payload = buildTemplatePayload({ to: "+27821234567", templateName: "t", language: "en", bodyParams: [], idempotencyKey: "k" }) as { template: Record<string, unknown> };
    expect(payload.template.components).toBeUndefined();
  });
});

describe("verifySignature", () => {
  const secret = "app-secret";
  const body = '{"object":"whatsapp_business_account"}';
  const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  it("accepts the right signature", () => {
    expect(verifySignature(body, good, secret)).toBe(true);
  });
  it("rejects a wrong secret, a missing header and a tampered body", () => {
    expect(verifySignature(body, good, "other")).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body + " ", good, secret)).toBe(false);
    expect(verifySignature(body, "sha1=abc", secret)).toBe(false);
  });
});

describe("parseWebhook", () => {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "267", phone_number_id: "p" },
              contacts: [{ profile: { name: "Sarah Smith" }, wa_id: "26771234567" }],
              messages: [
                { from: "26771234567", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "STOP" } },
                { from: "26771234567", id: "wamid.2", timestamp: "1700000001", type: "image", image: { id: "x" } },
                { from: "26771234567", id: "wamid.3", timestamp: "1700000002", type: "button", button: { text: "Yes", payload: "y" } },
              ],
              statuses: [
                { id: "wamid.out1", status: "delivered", timestamp: "1700000003", recipient_id: "26771234567" },
                { id: "wamid.out2", status: "failed", timestamp: "1700000004", errors: [{ code: 131026, title: "Message undeliverable" }] },
                { id: "wamid.out3", status: "unknown_state", timestamp: "1700000005" },
              ],
            },
          },
        ],
      },
    ],
  });
  it("reads texts and statuses through an allow-list and ignores the rest", () => {
    const events = parseWebhook(body);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ kind: "status", providerMessageId: "wamid.out1", status: "delivered" });
    expect(events[1]).toMatchObject({ kind: "status", providerMessageId: "wamid.out2", status: "failed", error: "131026 Message undeliverable" });
    expect(events[2]).toMatchObject({ kind: "text", providerMessageId: "wamid.1", from: "+26771234567", text: "STOP" });
    expect(events[3]).toMatchObject({ kind: "text", providerMessageId: "wamid.3", from: "+26771234567", text: "Yes" });
    expect((events[0] as { occurredAt: Date }).occurredAt.toISOString()).toBe("2023-11-14T22:13:23.000Z");
  });
  it("yields nothing for other objects or invalid JSON", () => {
    expect(parseWebhook('{"object":"page"}')).toEqual([]);
    expect(parseWebhook("not json")).toEqual([]);
  });
});

describe("send responses", () => {
  it("reads the message id", () => {
    expect(parseSendResponse({ messaging_product: "whatsapp", messages: [{ id: "wamid.X" }] })).toBe("wamid.X");
    expect(parseSendResponse({})).toBeNull();
  });
  it("reads an error", () => {
    expect(parseSendError({ error: { message: "Template name does not exist", code: 132001 } })).toBe("132001: Template name does not exist");
    expect(parseSendError(null)).toBe("request failed");
  });
});

describe("preview", () => {
  it("fills positional placeholders and counts them", () => {
    expect(renderPreview("Hi {{1}}, {{2}} is booked.", ["Sarah", "John"])).toBe("Hi Sarah, John is booked.");
    expect(placeholderCount("Hi {{1}}, {{3}}")).toBe(3);
    expect(placeholderCount("none")).toBe(0);
  });
});

describe("opt-out words", () => {
  it("recognises the ways a parent says stop", () => {
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut("please unsubscribe me")).toBe(false);
    expect(isOptOut("Unsubscribe")).toBe(true);
    expect(isOptOut("Stop sending these")).toBe(true);
    expect(isOptOut("What time is the assessment?")).toBe(false);
    expect(isOptIn("START")).toBe(true);
    expect(isOptIn("yes please")).toBe(true);
  });
});
