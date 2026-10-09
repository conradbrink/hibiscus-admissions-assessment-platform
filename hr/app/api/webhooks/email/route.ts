import { getEmailProvider } from "@/lib/email/provider";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delivery events for HR email, verified by signature before anything is
 * read. Configure it in Resend as its own webhook with its own secret, so
 * admissions and HR events never cross. Statuses only move forward.
 */
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, bounced: 5, failed: 5 };

export async function POST(request: Request) {
  const raw = await request.text();
  const provider = await getEmailProvider();
  const events = await provider.verifyWebhook(raw, request.headers);
  if (events === null) return Response.json({ error: "Invalid signature" }, { status: 401 });
  const admin = createAdminClient();
  for (const ev of events) {
    const { data: msg } = await admin.from("hr_email_messages").select("id, status").eq("provider_message_id", ev.providerMessageId).maybeSingle();
    if (!msg) continue;
    const at = ev.occurredAt.toISOString();
    const next = ev.kind === "complained" ? "bounced" : ev.kind;
    const status = (RANK[next] ?? 0) > (RANK[msg.status] ?? 0) ? (next as typeof msg.status) : msg.status;
    await admin
      .from("hr_email_messages")
      .update({
        status,
        ...(ev.kind === "delivered" ? { delivered_at: at } : {}),
        ...(ev.kind === "opened" ? { opened_at: at } : {}),
        ...(ev.kind === "bounced" || ev.kind === "complained" ? { bounced_at: at, bounce_reason: ev.reason ?? null } : {}),
      })
      .eq("id", msg.id);
  }
  return Response.json({ received: events.length });
}
