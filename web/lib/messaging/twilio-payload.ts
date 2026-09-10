import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundEvent, OutboundTemplateMessage } from "@/lib/messaging/provider";

/**
 * The pure half of the Twilio adapter: the form body of a send, the webhook
 * signature, and reading a webhook through an allow-list. No network, no
 * secrets held — everything here is unit tested.
 *
 * Two things about Twilio differ from Meta and shape this file.
 *
 * The first is that a WhatsApp template is not sent by name. Twilio wraps it
 * in a **Content Template** with a SID (`HX…`), and the variables go as one
 * JSON object keyed `"1"`, `"2"` — so the template row carries a content SID
 * beside its Meta name, and the two providers read their own column.
 *
 * The second is the signature. Meta signs the request body; Twilio signs the
 * **URL plus every form field**, sorted by name and concatenated with no
 * separator at all, under HMAC-SHA1. That means the URL Twilio called has to
 * match the one we verify against, down to the scheme and any query string —
 * which is why the adapter takes a URL rather than assuming one.
 */

/** Twilio's WhatsApp addresses are the E.164 number behind a `whatsapp:` scheme. */
export function toWhatsAppAddress(e164: string): string {
  return `whatsapp:${e164.startsWith("+") ? e164 : `+${e164.replace(/\D/g, "")}`}`;
}

/** And back: `whatsapp:+26771234567` → `+26771234567`. */
export function fromWhatsAppAddress(address: string): string {
  const digits = (address ?? "").replace(/^whatsapp:/i, "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/**
 * `{"1":"Abigail","2":"12 January"}` — Twilio's ContentVariables, positional
 * like Meta's `{{1}}…{{n}}` but as a JSON object of string keys.
 *
 * A template with a dynamic link button carries the token as the variable
 * after the body's, because a Twilio content template has one flat variable
 * space rather than Meta's separate button component. The runbook says to
 * author it that way.
 */
export function buildContentVariables(bodyParams: string[], buttonUrlSuffix?: string | null): string {
  const out: Record<string, string> = {};
  bodyParams.forEach((value, i) => {
    out[String(i + 1)] = value;
  });
  if (buttonUrlSuffix) out[String(bodyParams.length + 1)] = buttonUrlSuffix;
  return JSON.stringify(out);
}

export type TwilioSendOptions = {
  /** `whatsapp:+…` for the school's sending number, or null when a messaging service is used. */
  from: string | null;
  /** `MG…`, Twilio's messaging service, which owns the sender pool instead. */
  messagingServiceSid: string | null;
  /** Where Twilio should report delivery. Absolute, and the same URL the webhook verifies. */
  statusCallback: string | null;
};

export function buildMessageForm(message: OutboundTemplateMessage, opts: TwilioSendOptions): URLSearchParams {
  if (!message.providerTemplateId) {
    throw new Error("Twilio needs the template's content SID; set it on the message template.");
  }
  const form = new URLSearchParams();
  form.set("To", toWhatsAppAddress(message.to));
  // A messaging service owns the sender and takes precedence; a bare number
  // is the simpler setup and the one a school starts with.
  if (opts.messagingServiceSid) form.set("MessagingServiceSid", opts.messagingServiceSid);
  else if (opts.from) form.set("From", toWhatsAppAddress(opts.from));
  else throw new Error("Twilio needs either a sending number or a messaging service.");
  form.set("ContentSid", message.providerTemplateId);
  const variables = buildContentVariables(message.bodyParams, message.buttonUrlSuffix);
  // An empty object would be sent as "{}", which Twilio reads as "no
  // variables" anyway; omitting it keeps the request honest.
  if (variables !== "{}") form.set("ContentVariables", variables);
  if (opts.statusCallback) form.set("StatusCallback", opts.statusCallback);
  return form;
}

// ---------------------------------------------------------------------------
// The signature
// ---------------------------------------------------------------------------

/**
 * URL, then every parameter name immediately followed by its value, in
 * order of name. No separators anywhere — that is Twilio's rule, and a
 * plausible-looking variant with separators verifies nothing.
 */
export function signatureBase(url: string, params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
}

export function signatureFor(url: string, params: Record<string, string>, authToken: string): string {
  return createHmac("sha1", authToken).update(Buffer.from(signatureBase(url, params), "utf8")).digest("base64");
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null | undefined,
  authToken: string
): boolean {
  if (!signature) return false;
  const expected = signatureFor(url, params, authToken);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // Length first: timingSafeEqual throws on a mismatch, and the length of a
  // base64 SHA-1 is not a secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A form-encoded body as the flat map the signature and the parser both want. */
export function formToParams(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawBody)) out[key] = value;
  return out;
}

// ---------------------------------------------------------------------------
// Reading a webhook
// ---------------------------------------------------------------------------

/**
 * Twilio reports more states than we record. `queued` and `sending` say only
 * that Twilio has it, which the `queued` row already says; `undelivered` and
 * `failed` are the same fact to a school — the parent did not get it.
 */
const STATUS: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "failed",
};

/** Inbound bodies are a parent's words; longer than this is not a reply, it is a paste. */
export const MAX_INBOUND_LENGTH = 1000;

export function parseTwilioWebhook(params: Record<string, string>, now: Date = new Date()): InboundEvent[] {
  const sid = params.MessageSid || params.SmsSid || params.SmsMessageSid || "";
  if (!sid) return [];

  // A status callback carries MessageStatus; an inbound message carries Body.
  const status = params.MessageStatus || params.SmsStatus;
  if (status) {
    const mapped = STATUS[status.toLowerCase()];
    if (!mapped) return [];
    const code = params.ErrorCode;
    return [
      {
        kind: "status",
        providerMessageId: sid,
        status: mapped,
        error: mapped === "failed" ? [code, params.ErrorMessage].filter(Boolean).join(" ") || "delivery failed" : null,
        occurredAt: now,
      },
    ];
  }

  const from = fromWhatsAppAddress(params.From ?? "");
  if (!from) return [];
  const text = (params.Body ?? "").slice(0, MAX_INBOUND_LENGTH);
  return [{ kind: "text", providerMessageId: sid, from, text, occurredAt: now }];
}

// ---------------------------------------------------------------------------
// Reading a send response
// ---------------------------------------------------------------------------

export function parseSendResponse(body: unknown): string | null {
  const sid = (body as { sid?: unknown } | null)?.sid;
  return typeof sid === "string" && sid ? sid : null;
}

export function parseSendError(body: unknown): string {
  const b = body as { message?: unknown; code?: unknown; more_info?: unknown } | null;
  const parts = [typeof b?.code === "number" || typeof b?.code === "string" ? String(b.code) : "", typeof b?.message === "string" ? b.message : ""];
  const text = parts.filter(Boolean).join(" ");
  return text || "Twilio refused the message without saying why";
}
