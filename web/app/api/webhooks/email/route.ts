import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/lib/email/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delivery events from the email provider: delivered, opened, clicked,
 * bounced. Verified by signature before anything is read. Updates the
 * message row so the applicant's Emails tab shows what happened.
 *
 * Statuses only move forward: an "opened" arriving after "clicked" does
 * not demote the message.
 */
const RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: 5,
  failed: 5,
};

export async function POST(request: Request) {
  const raw = await request.text();
  const provider = await getEmailProvider();
  const events = await provider.verifyWebhook(raw, request.headers);
  if (events === null) return Response.json({ error: "Invalid signature" }, { status: 401 });

  const admin = createAdminClient();
  for (const ev of events) {
    const { data: msg } = await admin
      .from("email_messages")
      .select("id, status")
      .eq("provider_message_id", ev.providerMessageId)
      .maybeSingle();
    if (!msg) continue;

    const at = ev.occurredAt.toISOString();
    const stamp: Record<string, string> = {};
    let status = msg.status;
    if (ev.kind === "delivered") stamp.delivered_at = at;
    if (ev.kind === "opened") stamp.opened_at = at;
    if (ev.kind === "clicked") stamp.clicked_at = at;
    if (ev.kind === "bounced" || ev.kind === "complained") stamp.bounced_at = at;
    const next = ev.kind === "complained" ? "bounced" : ev.kind;
    if ((RANK[next] ?? 0) > (RANK[status] ?? 0)) status = next;

    // The reason goes in `error`, beside the send failures, because to the
    // office they are one question — why has this family not got their
    // letter — and a second column would mean looking in two places to
    // answer it. Written only when the provider gave one, so an existing
    // send error is never overwritten with a blank.
    if (ev.reason) stamp.error = ev.reason;

    await admin.from("email_messages").update({ ...stamp, status }).eq("id", msg.id);
  }
  return Response.json({ received: events.length });
}
