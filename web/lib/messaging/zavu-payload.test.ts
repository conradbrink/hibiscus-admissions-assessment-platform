import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOLERANCE_SECONDS,
  MAX_INBOUND_LENGTH,
  buildSendBody,
  numberedVariables,
  parseSendError,
  parseSendResponse,
  parseSignatureHeader,
  parseZavuWebhook,
  unwrapEnvelope,
  verifyZavuSignature,
} from "@/lib/messaging/zavu-payload";
import type { OutboundTemplateMessage } from "@/lib/messaging/provider";

const SECRET = "whsec-test";
const message: OutboundTemplateMessage = {
  to: "+26771234567",
  templateName: "booking_confirmed",
  providerTemplateId: "tmpl_booking_confirmed",
  language: "en",
  bodyParams: ["Abigail", "12 January 2027"],
  buttonUrlSuffix: null,
  idempotencyKey: "wa:booking:1",
};

describe("buildSendBody", () => {
  it("sends a WhatsApp template with its variables numbered from one", () => {
    expect(buildSendBody(message)).toEqual({
      to: "+26771234567",
      channel: "whatsapp",
      messageType: "template",
      idempotencyKey: "wa:booking:1",
      content: {
        templateId: "tmpl_booking_confirmed",
        templateVariables: { "1": "Abigail", "2": "12 January 2027" },
      },
    });
  });

  it("puts a link token in the button's own variables, not the body's", () => {
    const body = buildSendBody({ ...message, buttonUrlSuffix: "tok123" });
    const content = body.content as Record<string, unknown>;
    expect(content.templateVariables).toEqual({ "1": "Abigail", "2": "12 January 2027" });
    // Zero, not one. This test asserted "1" and passed, because it was
    // written from the same assumption the adapter was: that one numbering
    // scheme covers both. Zavu refuses that with `Missing URL button
    // parameter at index 0`, which is how it was found — on a real send.
    expect(content.templateButtonVariables).toEqual({ "0": "tok123" });
  });

  it("numbers the button from zero and the body from one, in the same send", () => {
    const content = buildSendBody({ ...message, buttonUrlSuffix: "tok123" }).content as Record<string, unknown>;
    expect(Object.keys(content.templateVariables as object)).toEqual(["1", "2"]);
    expect(Object.keys(content.templateButtonVariables as object)).toEqual(["0"]);
  });

  it("omits the variables when the template takes none", () => {
    const content = buildSendBody({ ...message, bodyParams: [] }).content as Record<string, unknown>;
    expect(content).toEqual({ templateId: "tmpl_booking_confirmed" });
  });

  it("refuses a template with no Zavu id", () => {
    expect(() => buildSendBody({ ...message, providerTemplateId: null })).toThrow(/template's id/);
  });

  it("never sends free text", () => {
    // WhatsApp allows it only inside a 24-hour reply window, and the school's
    // wording belongs in the templates the school controls.
    const body = buildSendBody(message);
    expect(body).not.toHaveProperty("text");
    expect(body.messageType).toBe("template");
  });

  it("numbers variables from one", () => {
    expect(numberedVariables(["a", "b", "c"])).toEqual({ "1": "a", "2": "b", "3": "c" });
    expect(numberedVariables([])).toEqual({});
  });
});

describe("the envelope", () => {
  it("unwraps a single named resource", () => {
    expect(unwrapEnvelope({ message: { id: "msg_1" } })).toEqual({ id: "msg_1" });
  });

  it("leaves anything else alone", () => {
    expect(unwrapEnvelope({ id: "msg_1", status: "queued" })).toEqual({ id: "msg_1", status: "queued" });
    expect(unwrapEnvelope({ message: { id: "a" }, extra: 1 })).toEqual({ message: { id: "a" }, extra: 1 });
    expect(unwrapEnvelope(null)).toEqual({});
    expect(unwrapEnvelope([1, 2])).toEqual({});
  });
});

describe("the signature", () => {
  const body = JSON.stringify({ type: "message.delivered", data: { id: "msg_1" } });
  const t = 1_757_491_200;
  const nowMs = t * 1000;
  const v2 = createHmac("sha256", SECRET).update(`${t}.${body}`, "utf8").digest("hex");
  const v1 = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");

  it("reads the parts in any order", () => {
    expect(parseSignatureHeader(`v1=${v1},t=${t},v2=${v2}`)).toEqual({ t, v1, v2 });
    expect(parseSignatureHeader("nonsense")).toEqual({});
  });

  it("accepts v2, which signs the timestamp with the body", () => {
    expect(verifyZavuSignature(SECRET, body, `t=${t},v2=${v2}`, DEFAULT_TOLERANCE_SECONDS, nowMs)).toEqual({ ok: true, version: "v2" });
  });

  it("accepts v1, which signs the body alone", () => {
    expect(verifyZavuSignature(SECRET, body, `t=${t},v1=${v1}`, DEFAULT_TOLERANCE_SECONDS, nowMs)).toEqual({ ok: true, version: "v1" });
  });

  it("refuses a tampered body, a wrong secret and a missing header", () => {
    expect(verifyZavuSignature(SECRET, `${body} `, `t=${t},v2=${v2}`, 300, nowMs)).toMatchObject({ ok: false });
    expect(verifyZavuSignature("other", body, `t=${t},v2=${v2}`, 300, nowMs)).toMatchObject({ ok: false });
    expect(verifyZavuSignature(SECRET, body, null, 300, nowMs)).toMatchObject({ ok: false });
    expect(verifyZavuSignature("", body, `t=${t},v2=${v2}`, 300, nowMs)).toMatchObject({ ok: false });
  });

  it("refuses a replayed delivery, and one from the future", () => {
    const old = verifyZavuSignature(SECRET, body, `t=${t},v2=${v2}`, 300, nowMs + 301_000);
    expect(old.ok).toBe(false);
    expect(old.ok === false && old.reason).toContain("old");
    expect(verifyZavuSignature(SECRET, body, `t=${t},v2=${v2}`, 300, nowMs - 120_000)).toMatchObject({ ok: false });
  });

  it("will not check age without a timestamp", () => {
    // Without `t` the tolerance means nothing, so the delivery is refused
    // rather than waved through on v1 alone.
    expect(verifyZavuSignature(SECRET, body, `v1=${v1}`, 300, nowMs)).toMatchObject({ ok: false });
    // Unless age checking is switched off entirely.
    expect(verifyZavuSignature(SECRET, body, `v1=${v1}`, 0, nowMs)).toEqual({ ok: true, version: "v1" });
  });

  it("does not throw on a signature of the wrong length", () => {
    expect(verifyZavuSignature(SECRET, body, `t=${t},v2=short`, 300, nowMs)).toMatchObject({ ok: false });
  });
});

describe("parseZavuWebhook", () => {
  const at = new Date("2026-09-10T08:00:00Z");
  const event = (type: string, data: Record<string, unknown>) => JSON.stringify({ type, data });

  it("reads each delivery status we record", () => {
    for (const [type, status] of [
      ["message.sent", "sent"],
      ["message.delivered", "delivered"],
      ["message.read", "read"],
    ] as const) {
      expect(parseZavuWebhook(event(type, { id: "msg_1" }), at)).toEqual([
        { kind: "status", providerMessageId: "msg_1", status, error: null, occurredAt: at },
      ]);
    }
  });

  it("keeps the reason on a failure", () => {
    const [e] = parseZavuWebhook(event("message.failed", { id: "msg_1", error: "not on WhatsApp" }), at);
    expect(e).toMatchObject({ kind: "status", status: "failed" });
    expect(e.kind === "status" && e.error).toBe("not on WhatsApp");
  });

  it("ignores what the row already says", () => {
    // `queued` is what the row was written as; the rest are calls, domains
    // and broadcasts this system does not use.
    expect(parseZavuWebhook(event("message.queued", { id: "msg_1" }), at)).toEqual([]);
    expect(parseZavuWebhook(event("call.answered", { id: "call_1" }), at)).toEqual([]);
  });

  it("reads a parent's reply", () => {
    expect(parseZavuWebhook(event("message.inbound", { id: "msg_2", from: "+26771234567", text: "Yes thank you" }), at)).toEqual([
      { kind: "text", providerMessageId: "msg_2", from: "+26771234567", text: "Yes thank you", occurredAt: at },
    ]);
  });

  it("truncates a reply nobody typed by hand", () => {
    const [e] = parseZavuWebhook(event("message.inbound", { id: "m", from: "+267", text: "x".repeat(5000) }), at);
    expect(e.kind === "text" && e.text.length).toBe(MAX_INBOUND_LENGTH);
  });

  it("finds the message wherever the envelope puts it", () => {
    // Their event carries the resource under `data`; a couple of other
    // spellings are accepted rather than dropping a real delivery.
    for (const body of [
      JSON.stringify({ type: "message.delivered", message: { id: "msg_3" } }),
      JSON.stringify({ type: "message.delivered", data: { message: { id: "msg_3" } } }),
    ]) {
      expect(parseZavuWebhook(body, at)).toEqual([
        { kind: "status", providerMessageId: "msg_3", status: "delivered", error: null, occurredAt: at },
      ]);
    }
  });

  it("returns nothing rather than half an event", () => {
    // A status we cannot place must not mark a message delivered, and a reply
    // we cannot attribute must not open a task.
    expect(parseZavuWebhook(event("message.delivered", {}), at)).toEqual([]);
    expect(parseZavuWebhook(event("message.inbound", { id: "m" }), at)).toEqual([]);
    expect(parseZavuWebhook(JSON.stringify({ data: { id: "m" } }), at)).toEqual([]);
    expect(parseZavuWebhook("not json", at)).toEqual([]);
    expect(parseZavuWebhook("[]", at)).toEqual([]);
  });
});

describe("the send response", () => {
  it("takes the id, through the envelope or without it", () => {
    expect(parseSendResponse({ message: { id: "msg_9" } })).toBe("msg_9");
    expect(parseSendResponse({ id: "msg_9" })).toBe("msg_9");
    expect(parseSendResponse({ message: {} })).toBeNull();
    expect(parseSendResponse(null)).toBeNull();
  });

  it("says what Zavu refused", () => {
    expect(parseSendError({ error: { code: "template_not_found", message: "No such template" } })).toContain("template_not_found");
    expect(parseSendError({ error: "bad request" })).toBe("bad request");
    expect(parseSendError({ message: "nope" })).toBe("nope");
    expect(parseSendError(null)).toContain("without saying why");
  });
});
