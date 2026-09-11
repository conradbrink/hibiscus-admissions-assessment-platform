/**
 * What a delivery receipt means — the pure half of the audit trail.
 *
 * Deliberately free of `server-only` and of any Supabase import, because both
 * sides need it: the webhook handler decides what to record with
 * `resolveStatus`, and the console renders `deliveryProof` beside every
 * message. A pure function kept inside a server-only module is a runtime
 * error waiting for the first component that renders it.
 */

// ---------------------------------------------------------------------------
// Which assertion wins
// ---------------------------------------------------------------------------

/**
 * Delivery receipts do not arrive in order. WhatsApp will happily deliver a
 * `sent` after a `delivered`, or repeat one it already sent, and a message
 * that has been read must not fall back to "sent" because a stale receipt
 * turned up late.
 *
 * So a status only moves forward through the ranking below. `failed` outranks
 * everything because a late failure is the one regression that is real — a
 * message can reach the network and still fail at the handset.
 *
 * This is the rule the webhook handler has always applied inline. It is a
 * function now because the audit trail needs to record the assertions it
 * *rejects* as well as the ones it accepts, and that means the decision has
 * to be a value rather than a branch.
 */
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

export type StatusDecision<T extends string = string> = { status: T; applied: boolean };

/**
 * Generic over the status union so the caller keeps its own narrower type:
 * the webhook handler writes the result straight back to `messages.status`,
 * which is a `MessageStatus`, not a bare string.
 */
export function resolveStatus<T extends string>(current: T, asserted: T): StatusDecision<T> {
  const wins = (RANK[asserted] ?? 0) > (RANK[current] ?? 0);
  return { status: wins ? asserted : current, applied: wins };
}

// ---------------------------------------------------------------------------
// What to tell the office
// ---------------------------------------------------------------------------

export type DeliveryProof = {
  /** The furthest the message got, as a sentence a person can read. */
  summary: string;
  /** True once the provider has confirmed the handset received it. */
  confirmed: boolean;
};

/**
 * What to show beside a message so staff can see it actually arrived.
 *
 * `sent` means only that the provider accepted it — the school has been
 * burned by that distinction already, because a template with a malformed
 * button is accepted, given an id, and then never delivered. `delivered` is
 * the first status that means a phone has it. The wording keeps the two apart
 * rather than calling both of them "sent".
 */
export function deliveryProof(m: {
  direction: string;
  status: string;
  error: string | null;
}): DeliveryProof {
  if (m.direction === "in") return { summary: "Received from the parent", confirmed: true };
  switch (m.status) {
    case "read":
      return { summary: "Delivered and read on the parent's phone", confirmed: true };
    case "delivered":
      return { summary: "Delivered to the parent's phone", confirmed: true };
    case "sent":
      return { summary: "Accepted by WhatsApp, not yet confirmed on the phone", confirmed: false };
    case "queued":
      return { summary: "Waiting to go out", confirmed: false };
    case "failed":
      return { summary: m.error ? `Not delivered: ${m.error}` : "Not delivered", confirmed: false };
    case "skipped":
      return { summary: m.error ? `Not sent: ${m.error}` : "Not sent", confirmed: false };
    default:
      return { summary: m.status, confirmed: false };
  }
}
