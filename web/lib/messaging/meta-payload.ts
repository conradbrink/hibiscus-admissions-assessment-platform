import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundEvent, OutboundTemplateMessage } from "@/lib/messaging/provider";

/**
 * The pure half of the Meta WhatsApp Cloud API adapter: building the request
 * body, verifying a webhook signature, and reading a webhook body through an
 * allow-list. No network, no secrets held — everything here is unit tested.
 *
 * Shapes follow Meta's documented Cloud API: POST /{phone-number-id}/messages
 * with a `template` object, and a webhook whose `entry[].changes[].value`
 * carries `messages` (inbound) and `statuses` (delivery).
 */

/** Meta rejects parameters with line breaks, tabs, or more than four consecutive spaces; and caps their length. */
export const MAX_PARAM_LENGTH = 1024;

export function sanitiseParam(value: string | null | undefined): string {
  const text = (value ?? "")
    .replace(/\r\n|\r|\n/g, ", ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .replace(/(, )+/g, ", ")
    .trim()
    .replace(/^,\s*|,\s*$/g, "");
  return text.length > MAX_PARAM_LENGTH ? text.slice(0, MAX_PARAM_LENGTH - 1) + "…" : text;
}

/** E.164 without the plus, which is how the Cloud API wants a recipient. */
export function toWaId(e164: string): string {
  return e164.replace(/^\+/, "");
}

/** Back to E.164 with the plus, which is how we store numbers. */
export function fromWaId(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export function buildTemplatePayload(message: OutboundTemplateMessage): Record<string, unknown> {
  const components: Array<Record<string, unknown>> = [];
  if (message.bodyParams.length) {
    components.push({
      type: "body",
      parameters: message.bodyParams.map((text) => ({ type: "text", text })),
    });
  }
  if (message.buttonUrlSuffix) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: message.buttonUrlSuffix }],
    });
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWaId(message.to),
    type: "template",
    template: {
      name: message.templateName,
      language: { code: message.language },
      ...(components.length ? { components } : {}),
    },
  };
}

/** `X-Hub-Signature-256: sha256=<hex>` over the raw body with the app secret. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const given = header.slice("sha256=".length).trim().toLowerCase();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

/** Replaces {{1}}…{{n}} in the approved wording, for the record and the preview. */
export function renderPreview(bodyPreview: string, params: string[]): string {
  return bodyPreview.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}

/** How many {{n}} placeholders the wording has; the highest index counts, so a gap is a mistake. */
export function placeholderCount(bodyPreview: string): number {
  let max = 0;
  for (const m of bodyPreview.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

type Unknown = Record<string, unknown>;
const obj = (v: unknown): Unknown | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Unknown) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/**
 * Reads a webhook body. Only the fields we act on are read; anything else,
 * including profile names and unknown message types, is ignored. A body
 * that is not a WhatsApp Business Account notification yields no events.
 */
export function parseWebhook(rawBody: string): InboundEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const root = obj(parsed);
  if (!root || root.object !== "whatsapp_business_account") return [];
  const events: InboundEvent[] = [];
  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const value = obj(obj(change)?.value);
      if (!value || value.messaging_product !== "whatsapp") continue;
      for (const s of arr(value.statuses)) {
        const status = obj(s);
        const id = str(status?.id);
        const state = str(status?.status);
        if (!id || !state || !STATUSES.has(state)) continue;
        const firstError = obj(arr(status?.errors)[0]);
        const code = firstError && (typeof firstError.code === "number" || typeof firstError.code === "string") ? String(firstError.code) : null;
        events.push({
          kind: "status",
          providerMessageId: id,
          status: state as "sent" | "delivered" | "read" | "failed",
          error: firstError ? [code, str(firstError.title)].filter(Boolean).join(" ") || null : null,
          occurredAt: tsToDate(status?.timestamp),
        });
      }
      for (const m of arr(value.messages)) {
        const msg = obj(m);
        const id = str(msg?.id);
        const from = str(msg?.from);
        if (!id || !from) continue;
        let text: string | null = null;
        if (msg?.type === "text") text = str(obj(msg.text)?.body);
        else if (msg?.type === "button") text = str(obj(msg.button)?.text);
        else if (msg?.type === "interactive") {
          const i = obj(msg.interactive);
          text = str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title);
        }
        if (text === null) continue;
        events.push({ kind: "text", providerMessageId: id, from: fromWaId(from), text, occurredAt: tsToDate(msg?.timestamp) });
      }
    }
  }
  return events;
}

function tsToDate(v: unknown): Date {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** The message id from a successful send response, or null. */
export function parseSendResponse(body: unknown): string | null {
  const root = obj(body);
  const first = obj(arr(root?.messages)[0]);
  return str(first?.id);
}

/** The error message from a failed send response, best effort. */
export function parseSendError(body: unknown): string {
  const err = obj(obj(body)?.error);
  const code = err?.code !== undefined ? String(err.code) : null;
  const message = str(err?.message) ?? "request failed";
  return code ? `${code}: ${message}` : message;
}

/** A reply that means "stop messaging me", in the words parents actually use. */
export function isOptOut(text: string): boolean {
  return /^\s*(stop|unsubscribe|cancel|opt\s*out|no more)\b/i.test(text);
}

/** A reply that means "message me again". */
export function isOptIn(text: string): boolean {
  return /^\s*(start|subscribe|opt\s*in|yes)\b/i.test(text);
}
