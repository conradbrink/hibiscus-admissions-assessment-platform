import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_INBOUND_LENGTH,
  buildContentVariables,
  buildMessageForm,
  formToParams,
  fromWhatsAppAddress,
  parseSendError,
  parseSendResponse,
  parseTwilioWebhook,
  signatureBase,
  signatureFor,
  toWhatsAppAddress,
  verifyTwilioSignature,
} from "@/lib/messaging/twilio-payload";
import type { OutboundTemplateMessage } from "@/lib/messaging/provider";

const CONTENT_SID = "HX1234567890abcdef1234567890abcdef";
const TOKEN = "test-auth-token";

const message: OutboundTemplateMessage = {
  to: "+26771234567",
  templateName: "booking_confirmed",
  providerTemplateId: CONTENT_SID,
  language: "en",
  bodyParams: ["Abigail", "12 January 2027"],
  buttonUrlSuffix: null,
  idempotencyKey: "k1",
};

describe("addresses", () => {
  it("wraps and unwraps Twilio's whatsapp: scheme", () => {
    expect(toWhatsAppAddress("+26771234567")).toBe("whatsapp:+26771234567");
    expect(toWhatsAppAddress("26771234567")).toBe("whatsapp:+26771234567");
    expect(fromWhatsAppAddress("whatsapp:+26771234567")).toBe("+26771234567");
    expect(fromWhatsAppAddress("whatsapp:+267 71 234 567")).toBe("+26771234567");
    expect(fromWhatsAppAddress("")).toBe("");
  });
});

describe("content variables", () => {
  it("numbers the body parameters from one", () => {
    expect(buildContentVariables(["Abigail", "Monday"])).toBe('{"1":"Abigail","2":"Monday"}');
  });

  it("puts a link token after the body's, as one flat space", () => {
    // Twilio has no separate button component: the link is just the next
    // variable, and the template has to be authored that way.
    expect(buildContentVariables(["Abigail"], "tok123")).toBe('{"1":"Abigail","2":"tok123"}');
  });

  it("is an empty object when there is nothing to fill", () => {
    expect(buildContentVariables([])).toBe("{}");
  });
});

describe("buildMessageForm", () => {
  it("sends the content SID, the variables and the sender", () => {
    const form = buildMessageForm(message, { from: "+14155238886", messagingServiceSid: null, statusCallback: null });
    expect(form.get("To")).toBe("whatsapp:+26771234567");
    expect(form.get("From")).toBe("whatsapp:+14155238886");
    expect(form.get("ContentSid")).toBe(CONTENT_SID);
    expect(form.get("ContentVariables")).toBe('{"1":"Abigail","2":"12 January 2027"}');
    expect(form.get("MessagingServiceSid")).toBeNull();
  });

  it("prefers a messaging service when one is configured", () => {
    const form = buildMessageForm(message, { from: "+14155238886", messagingServiceSid: "MG0000", statusCallback: null });
    expect(form.get("MessagingServiceSid")).toBe("MG0000");
    expect(form.get("From")).toBeNull();
  });

  it("carries the status callback when there is one", () => {
    const form = buildMessageForm(message, { from: "+1", messagingServiceSid: null, statusCallback: "https://x/api/webhooks/whatsapp" });
    expect(form.get("StatusCallback")).toBe("https://x/api/webhooks/whatsapp");
  });

  it("omits the variables when the template takes none", () => {
    const form = buildMessageForm({ ...message, bodyParams: [] }, { from: "+1", messagingServiceSid: null, statusCallback: null });
    expect(form.get("ContentVariables")).toBeNull();
  });

  it("refuses to send without a content SID or a sender", () => {
    expect(() => buildMessageForm({ ...message, providerTemplateId: null }, { from: "+1", messagingServiceSid: null, statusCallback: null })).toThrow(/content SID/);
    expect(() => buildMessageForm(message, { from: null, messagingServiceSid: null, statusCallback: null })).toThrow(/sending number/);
  });
});

describe("the signature", () => {
  const url = "https://admissions.example.com/api/webhooks/whatsapp";
  const params = { MessageStatus: "delivered", MessageSid: "SM123", AccountSid: "AC1" };

  it("is the URL then every field, sorted by name and run together", () => {
    // Twilio's rule exactly: no separators anywhere. A variant with them
    // looks plausible and verifies nothing.
    expect(signatureBase(url, params)).toBe(`${url}AccountSidAC1MessageSidSM123MessageStatusdelivered`);
  });

  it("accepts a signature Twilio would have produced", () => {
    const expected = createHmac("sha1", TOKEN).update(Buffer.from(signatureBase(url, params), "utf8")).digest("base64");
    expect(signatureFor(url, params, TOKEN)).toBe(expected);
    expect(verifyTwilioSignature(url, params, expected, TOKEN)).toBe(true);
  });

  it("refuses a tampered field, a wrong token, a different URL, and a missing header", () => {
    const good = signatureFor(url, params, TOKEN);
    expect(verifyTwilioSignature(url, { ...params, MessageStatus: "read" }, good, TOKEN)).toBe(false);
    expect(verifyTwilioSignature(url, params, good, "other-token")).toBe(false);
    // The scheme alone is enough to break it, which is why the adapter takes
    // an override for deploys behind a proxy.
    expect(verifyTwilioSignature(url.replace("https", "http"), params, good, TOKEN)).toBe(false);
    expect(verifyTwilioSignature(url, params, null, TOKEN)).toBe(false);
    expect(verifyTwilioSignature(url, params, "", TOKEN)).toBe(false);
  });

  it("does not throw on a signature of the wrong length", () => {
    expect(verifyTwilioSignature(url, params, "short", TOKEN)).toBe(false);
  });

  it("reads a form body into the map both the signature and the parser use", () => {
    expect(formToParams("MessageSid=SM1&Body=hello+there")).toEqual({ MessageSid: "SM1", Body: "hello there" });
  });
});

describe("parseTwilioWebhook", () => {
  const at = new Date("2026-09-10T08:00:00Z");

  it("reads a delivery status", () => {
    expect(parseTwilioWebhook({ MessageSid: "SM1", MessageStatus: "delivered" }, at)).toEqual([
      { kind: "status", providerMessageId: "SM1", status: "delivered", error: null, occurredAt: at },
    ]);
  });

  it("treats undelivered as failed, and keeps the reason", () => {
    const [event] = parseTwilioWebhook({ MessageSid: "SM1", MessageStatus: "undelivered", ErrorCode: "63016" }, at);
    expect(event).toMatchObject({ kind: "status", status: "failed" });
    expect(event.kind === "status" && event.error).toContain("63016");
  });

  it("ignores the states we already know", () => {
    // `queued` and `sending` say only that Twilio has it, which the row said
    // when it was written.
    expect(parseTwilioWebhook({ MessageSid: "SM1", MessageStatus: "queued" }, at)).toEqual([]);
    expect(parseTwilioWebhook({ MessageSid: "SM1", MessageStatus: "sending" }, at)).toEqual([]);
  });

  it("reads a parent's reply", () => {
    expect(parseTwilioWebhook({ MessageSid: "SM2", From: "whatsapp:+26771234567", Body: "Yes thank you" }, at)).toEqual([
      { kind: "text", providerMessageId: "SM2", from: "+26771234567", text: "Yes thank you", occurredAt: at },
    ]);
  });

  it("truncates a reply nobody typed by hand", () => {
    const [event] = parseTwilioWebhook({ MessageSid: "SM3", From: "whatsapp:+26771234567", Body: "x".repeat(5000) }, at);
    expect(event.kind === "text" && event.text.length).toBe(MAX_INBOUND_LENGTH);
  });

  it("drops what it cannot place", () => {
    expect(parseTwilioWebhook({ MessageStatus: "delivered" }, at)).toEqual([]);
    expect(parseTwilioWebhook({ MessageSid: "SM4", Body: "hi" }, at)).toEqual([]);
    expect(parseTwilioWebhook({}, at)).toEqual([]);
  });
});

describe("the send response", () => {
  it("takes the message sid", () => {
    expect(parseSendResponse({ sid: "SM9", status: "queued" })).toBe("SM9");
    expect(parseSendResponse({ status: "queued" })).toBeNull();
    expect(parseSendResponse(null)).toBeNull();
  });

  it("says what Twilio refused, with its code", () => {
    expect(parseSendError({ code: 63016, message: "Failed to send freeform message" })).toContain("63016");
    expect(parseSendError({ code: 63016, message: "Failed to send freeform message" })).toContain("freeform");
    expect(parseSendError(null)).toContain("without saying why");
  });
});
