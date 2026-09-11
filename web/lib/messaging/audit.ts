import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * The WhatsApp audit trail.
 *
 * `messages.status` is the current state of a message and is overwritten as
 * the message moves. This records each assertion that moved it — and each one
 * that did not — so the history survives the overwrite.
 *
 * Recording is deliberately best-effort: a trail that cannot be written must
 * never stop a parent's message going out, and must never turn a successful
 * send into a failure. Every call here swallows its own error rather than
 * throwing into the send path.
 */

export type MessageEventStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "skipped" | "received";
export type MessageEventSource = "send" | "webhook" | "staff" | "system";

export type RecordEventInput = {
  messageId: string;
  status: MessageEventStatus;
  source: MessageEventSource;
  actorId?: string | null;
  actorLabel?: string | null;
  /** The provider's own status word, before we mapped it onto one of ours. */
  providerStatus?: string | null;
  /** The provider's own words: why it failed, or why the moment was skipped. */
  detail?: string | null;
  /** False when the assertion was recorded but did not move `messages.status`. */
  applied?: boolean;
  /** When it happened, per whoever is asserting it. Defaults to now. */
  occurredAt?: Date | null;
};

export async function recordMessageEvent(admin: AdminClient, input: RecordEventInput): Promise<void> {
  const { error } = await admin.from("message_events").insert({
    message_id: input.messageId,
    status: input.status,
    source: input.source,
    actor_id: input.actorId ?? null,
    actor_label: input.actorLabel ?? null,
    provider_status: input.providerStatus ?? null,
    detail: input.detail ?? null,
    applied: input.applied ?? true,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
  });
  // Deliberately not rethrown: see the note at the top of the file.
  if (error) console.error("message_events insert failed", { messageId: input.messageId, status: input.status, error: error.message });
}

/*
 * `resolveStatus` and `deliveryProof` are pure and deliberately NOT re-exported
 * from here. They live in `./delivery`, and every caller — webhook handler and
 * console alike — imports them from there. Re-exporting them through this
 * server-only module would put a working import path in front of the next
 * component that needs one, and it would fail at runtime, not at build.
 */
