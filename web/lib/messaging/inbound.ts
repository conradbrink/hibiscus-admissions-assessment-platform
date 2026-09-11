import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { recordMessageEvent } from "@/lib/messaging/audit";
import { resolveStatus } from "@/lib/messaging/delivery";
import { isOptIn, isOptOut } from "@/lib/messaging/meta-payload";
import type { InboundEvent } from "@/lib/messaging/provider";
import { commit, SYSTEM_ACTOR } from "@/lib/workflow/engine";
import { TERMINAL_STATUSES } from "@/lib/workflow/states";

/**
 * What arrives from the channel: delivery statuses for what we sent, and
 * the parent's replies. Statuses only move forward. A reply is matched to
 * the contact by number and to their most recent live application; "stop"
 * clears the opt-in, anything else becomes a task for the campus team.
 * Numbers we do not know are dropped and counted, never stored.
 */

export const INBOUND_TEXT_LIMIT = 1000;

export type InboundSummary = { statuses: number; replies: number; optOuts: number; optIns: number; unknown: number };

export async function handleInboundEvents(admin: AdminClient, events: InboundEvent[]): Promise<InboundSummary> {
  const summary: InboundSummary = { statuses: 0, replies: 0, optOuts: 0, optIns: 0, unknown: 0 };
  for (const ev of events) {
    if (ev.kind === "status") {
      await applyStatus(admin, ev);
      summary.statuses += 1;
      continue;
    }
    const outcome = await handleReply(admin, ev.from, ev.text, ev.providerMessageId, ev.occurredAt);
    if (outcome === "unknown") summary.unknown += 1;
    else if (outcome === "opt_out") summary.optOuts += 1;
    else if (outcome === "opt_in") summary.optIns += 1;
    else summary.replies += 1;
  }
  return summary;
}

/**
 * One delivery receipt from the provider.
 *
 * The receipt is recorded on the trail whether or not it moves the message.
 * A `sent` that arrives after a `delivered`, or a receipt the provider simply
 * repeats, changes nothing about the message and is still worth having: when
 * a family says they never got something, the question is what the provider
 * claimed and when, not what our single status column happens to say now.
 */
async function applyStatus(admin: AdminClient, ev: Extract<InboundEvent, { kind: "status" }>): Promise<void> {
  const { data: msg } = await admin.from("messages").select("id, status").eq("provider_message_id", ev.providerMessageId).maybeSingle();
  if (!msg) return;
  const at = ev.occurredAt.toISOString();
  const stamp: Record<string, string> = {};
  if (ev.status === "delivered") stamp.delivered_at = at;
  if (ev.status === "read") stamp.read_at = at;
  const { status, applied } = resolveStatus(msg.status, ev.status);
  // The timestamps are stamped even when the status does not move: a
  // `delivered` after a `read` still tells us when the handset got it.
  await admin
    .from("messages")
    .update({ ...stamp, status, ...(ev.status === "failed" ? { error: ev.error ?? "delivery failed" } : {}) })
    .eq("id", msg.id);
  await recordMessageEvent(admin, {
    messageId: msg.id,
    status: ev.status,
    source: "webhook",
    providerStatus: ev.status,
    detail: ev.error ?? (applied ? null : `Arrived after the message was already ${msg.status}`),
    applied,
    occurredAt: ev.occurredAt,
  });
}

export type ReplyOutcome = "unknown" | "opt_out" | "opt_in" | "task" | "duplicate";

/**
 * One reply. Exported so the development outbox can simulate a parent
 * replying without a webhook; the path is identical.
 */
export async function handleReply(admin: AdminClient, from: string, text: string, providerMessageId: string, occurredAt: Date): Promise<ReplyOutcome> {
  if (!from) return "unknown";
  const { data: contact } = await admin.from("contacts").select("id, first_name, last_name").eq("mobile_normalised", from).maybeSingle();
  if (!contact) return "unknown";

  const { data: apps } = await admin
    .from("applications")
    .select("id, status, child_first_name, reference")
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const app = (apps ?? []).find((a) => !TERMINAL_STATUSES.has(a.status)) ?? apps?.[0];
  if (!app) return "unknown";

  const body = text.trim().slice(0, INBOUND_TEXT_LIMIT);
  const { data: inserted } = await admin
    .from("messages")
    .upsert(
      {
        application_id: app.id,
        contact_id: contact.id,
        direction: "in",
        from_normalised: from,
        provider: "whatsapp",
        provider_message_id: providerMessageId,
        status: "received",
        rendered_text: body,
        received_at: occurredAt.toISOString(),
        trigger_source: "inbound",
      },
      { onConflict: "provider_message_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();
  if (!inserted) return "duplicate";
  await recordMessageEvent(admin, {
    messageId: inserted.id,
    status: "received",
    source: "webhook",
    providerStatus: "message.inbound",
    occurredAt,
  });

  if (isOptOut(body)) {
    await admin.from("contacts").update({ whatsapp_opt_in: false, whatsapp_opt_out_at: new Date().toISOString() }).eq("id", contact.id);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "messaging.opted_out", summary: "Parent replied STOP on WhatsApp; no more messages", payload: { message_id: inserted.id } },
      actor: SYSTEM_ACTOR,
    });
    return "opt_out";
  }
  if (isOptIn(body)) {
    await admin
      .from("contacts")
      .update({ whatsapp_opt_in: true, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_in_source: "reply", whatsapp_opt_out_at: null })
      .eq("id", contact.id);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "messaging.opted_in", summary: "Parent replied START on WhatsApp; messages resume", payload: { message_id: inserted.id } },
      actor: SYSTEM_ACTOR,
    });
    return "opt_in";
  }

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: "message.received", summary: "Parent replied on WhatsApp", payload: { message_id: inserted.id } },
    tasks: [
      {
        type: "parent_replied",
        title: `${contact.first_name} ${contact.last_name} replied on WhatsApp (${app.child_first_name})`,
        details: `“${body.slice(0, 300)}”\n\nReply by phone or email; a WhatsApp reply can only be one of the approved templates.`,
        priority: "normal",
      },
    ],
    actor: SYSTEM_ACTOR,
  });
  return "task";
}
