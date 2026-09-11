import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundEvent, OutboundTemplateMessage } from "@/lib/messaging/provider";

/**
 * The pure half of the Zavu adapter: the JSON body of a send, the webhook
 * signature, and reading a webhook through an allow-list. No network, no
 * secrets held — everything here is unit tested.
 *
 * Shapes follow Zavu's own n8n node (`n8n-nodes-zavu` on npm), which is the
 * authoritative statement of the wire format: `POST /v1/messages` with
 * `messageType: "template"` and a `content` object carrying the template's id
 * and its variables; a response wrapped in a one-key envelope; and a webhook
 * signed `t=…,v1=…,v2=…` under HMAC-SHA256.
 *
 * Zavu sends free text as happily as a template. We still only send
 * templates: WhatsApp allows free text solely inside a 24-hour reply window,
 * so nothing scheduled could use it, and the school's wording belongs in the
 * templates the school controls rather than in this repository.
 */

/** Their envelope: a single key naming the resource, with the object inside. */
const ENVELOPE_KEYS = ["message", "conversation", "contact", "sender", "template"];

export function unwrapEnvelope(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 1 && ENVELOPE_KEYS.includes(keys[0])) {
    const inner = obj[keys[0]];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
  }
  return obj;
}

/**
 * Variables are keyed by position — "1", "2" — because that is what a
 * WhatsApp template's `{{1}}` placeholders are, and our `parameters` column is
 * already an ordered list. The link token goes in the button's own record
 * rather than being appended to the body's, which is Zavu's shape and one
 * fewer thing to get wrong when a template is authored.
 */
export function numberedVariables(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  values.forEach((value, i) => {
    out[String(i + 1)] = value;
  });
  return out;
}

/**
 * The button's variables are numbered from **zero**, where the body's are
 * numbered from one. Both are "the template's variables", and assuming one
 * scheme for both is the obvious reading; Zavu uses two, and says so only by
 * refusing the send:
 *
 *     400 invalid_request Missing URL button parameter at index 0.
 *     Provide content.templateButtonVariables["0"].
 *
 * Twelve of the thirteen live templates carry a button, so this failed every
 * one of them the first time a parent should have received a message. The
 * body's numbering is untouched: `{{1}}` really is its first variable.
 */
export function buttonVariables(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  values.forEach((value, i) => {
    out[String(i)] = value;
  });
  return out;
}

export function buildSendBody(message: OutboundTemplateMessage): Record<string, unknown> {
  if (!message.providerTemplateId) {
    throw new Error("Zavu needs the template's id; set it on the message template.");
  }
  const content: Record<string, unknown> = { templateId: message.providerTemplateId };
  if (message.bodyParams.length) content.templateVariables = numberedVariables(message.bodyParams);
  if (message.buttonUrlSuffix) content.templateButtonVariables = buttonVariables([message.buttonUrlSuffix]);
  return {
    to: message.to,
    channel: "whatsapp",
    messageType: "template",
    // Their own idempotency, on top of ours: the `messages` row is keyed the
    // same way, so a retried job cannot message a parent twice at either end.
    idempotencyKey: message.idempotencyKey,
    content,
  };
}

// ---------------------------------------------------------------------------
// The signature
// ---------------------------------------------------------------------------

export type SignatureParts = { t?: number; v1?: string; v2?: string };

/** `t=1757491200,v1=<hex>,v2=<hex>` — order is not promised, so it is parsed. */
export function parseSignatureHeader(header: string): SignatureParts {
  const parsed: SignatureParts = {};
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "t") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) parsed.t = seconds;
    } else if (key === "v1") parsed.v1 = value;
    else if (key === "v2") parsed.v2 = value;
  }
  return parsed;
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Five minutes, which is Zavu's own default and long enough for a retry. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * `v2` signs the timestamp with the body, so a delivery cannot be replayed
 * once it is stale; `v1` signs the body alone and is accepted for a sender
 * that has not been moved to v2 yet. A missing timestamp is refused rather
 * than waved through, because without it the tolerance means nothing.
 */
export function verifyZavuSignature(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
  nowMs: number = Date.now()
): { ok: true; version: "v1" | "v2" } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "no X-Zavu-Signature header" };
  if (!secret) return { ok: false, reason: "no webhook secret configured" };

  const parsed = parseSignatureHeader(header);
  if (parsed.v1 === undefined && parsed.v2 === undefined) {
    return { ok: false, reason: "header carries no v1 or v2 part" };
  }
  if (toleranceSeconds > 0) {
    if (parsed.t === undefined) return { ok: false, reason: "header carries no usable t part" };
    const age = Math.floor(nowMs / 1000) - parsed.t;
    if (age > toleranceSeconds) return { ok: false, reason: `delivery is ${age}s old` };
    // A little slack for clocks that disagree, and no more.
    if (age < -60) return { ok: false, reason: "timestamp is in the future" };
  }
  if (parsed.v2 !== undefined && parsed.t !== undefined) {
    if (constantTimeEqual(hmacHex(secret, `${parsed.t}.${rawBody}`), parsed.v2)) return { ok: true, version: "v2" };
  }
  if (parsed.v1 !== undefined) {
    if (constantTimeEqual(hmacHex(secret, rawBody), parsed.v1)) return { ok: true, version: "v1" };
  }
  return { ok: false, reason: "signature mismatch" };
}

// ---------------------------------------------------------------------------
// Reading a webhook
// ---------------------------------------------------------------------------

/**
 * Zavu reports more than we record. `message.queued` says only that Zavu has
 * it, which the row already said when it was written, and the rest are about
 * calls, domains and broadcasts this system does not use.
 */
const STATUS: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  "message.sent": "sent",
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

const INBOUND_EVENT = "message.inbound";

/** A parent's reply; longer than this is not a reply, it is a paste. */
export const MAX_INBOUND_LENGTH = 1000;

/** Their envelope for an event puts the resource under `data`; be forgiving about it. */
function messageOf(body: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["data", "message", "payload"]) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const inner = unwrapEnvelope(value);
      if (Object.keys(inner).length) return inner;
    }
  }
  return body;
}

function firstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/**
 * One event per delivery. Anything not recognised returns nothing rather than
 * a half-read event: a status we cannot place must not mark a message
 * delivered, and a reply we cannot attribute must not open a task.
 */
export function parseZavuWebhook(rawBody: string, now: Date = new Date()): InboundEvent[] {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    body = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const type = typeof body.type === "string" ? body.type : "";
  if (!type) return [];
  const message = messageOf(body);

  const status = STATUS[type];
  if (status) {
    const id = firstString(message, ["id", "messageId", "message_id"]);
    if (!id) return [];
    const error = status === "failed" ? firstString(message, ["error", "errorMessage", "failureReason"]) || "delivery failed" : null;
    return [{ kind: "status", providerMessageId: id, status, error, occurredAt: now }];
  }

  if (type === INBOUND_EVENT) {
    const id = firstString(message, ["id", "messageId", "message_id"]);
    const from = firstString(message, ["from", "fromNumber", "sender"]);
    if (!id || !from) return [];
    const text = firstString(message, ["text", "body"]).slice(0, MAX_INBOUND_LENGTH);
    return [{ kind: "text", providerMessageId: id, from, text, occurredAt: now }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Reading a send response
// ---------------------------------------------------------------------------

export function parseSendResponse(body: unknown): string | null {
  const message = unwrapEnvelope(body);
  const id = firstString(message, ["id", "messageId", "message_id"]);
  return id || null;
}

export function parseSendError(body: unknown): string {
  if (!body || typeof body !== "object") return "Zavu refused the message without saying why";
  const b = body as { error?: unknown; message?: unknown; code?: unknown };
  const error = b.error;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown };
    const text = [typeof e.code === "string" ? e.code : "", typeof e.message === "string" ? e.message : ""].filter(Boolean).join(" ");
    if (text) return text;
  }
  if (typeof error === "string" && error) return error;
  const text = [typeof b.code === "string" ? b.code : "", typeof b.message === "string" ? b.message : ""].filter(Boolean).join(" ");
  return text || "Zavu refused the message without saying why";
}
