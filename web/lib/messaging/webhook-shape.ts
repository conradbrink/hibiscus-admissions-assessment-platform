/**
 * What a webhook body looked like, when we could make nothing of it.
 *
 * A delivery we do not recognise is answered `200` with an empty event list
 * and forgotten — which is correct behaviour (the provider must not retry
 * something we will never want) and terrible diagnostics. Parents' replies
 * have never once reached this system, and the reason cannot be established
 * from the outside: a body that arrives and is discarded looks exactly like a
 * body that never arrived.
 *
 * So describe the shape and keep that. **Keys, not values.** The one value
 * worth keeping is the event type, because that is the thing we match on and
 * the thing most likely to be wrong. A parent's message text, their number
 * and their name are none of our business here — this is for working out
 * which field names to read, and it must not turn the audit trail into a
 * copy of the conversation.
 */

export type WebhookShape = {
  /** The event name, if the body carries one under any of the usual spellings. */
  type: string | null;
  /** Top-level keys of the body. */
  keys: string[];
  /** Keys one level down, per top-level object key. */
  inner: Record<string, string[]>;
  /** Set when the body was not JSON we could read at all. */
  unparsable?: true;
};

/** The spellings a provider might use for "what happened". */
const TYPE_KEYS = ["type", "event", "eventType", "event_type", "name", "kind"];

function keysOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.length ? ["[]"] : [];
  return Object.keys(value as Record<string, unknown>).slice(0, 40);
}

export function describeWebhookShape(raw: string): WebhookShape {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { type: null, keys: [], inner: {}, unparsable: true };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { type: null, keys: [], inner: {}, unparsable: true };
  }
  const record = body as Record<string, unknown>;

  let type: string | null = null;
  for (const key of TYPE_KEYS) {
    const value = record[key];
    // A type is a short token. Anything long is prose, and prose here would
    // be the parent's own words.
    if (typeof value === "string" && value && value.length <= 80) {
      type = value;
      break;
    }
  }

  const inner: Record<string, string[]> = {};
  for (const key of keysOf(record)) {
    const child = record[key];
    if (child && typeof child === "object") {
      const childKeys = keysOf(child);
      if (childKeys.length) inner[key] = childKeys;
    }
  }
  return { type, keys: keysOf(record), inner };
}
