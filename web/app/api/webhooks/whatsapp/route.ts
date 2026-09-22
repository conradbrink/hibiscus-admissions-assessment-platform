import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminClient } from "@/lib/supabase/admin";
import { handleInboundEvents } from "@/lib/messaging/inbound";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { describeWebhookShape } from "@/lib/messaging/webhook-shape";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The WhatsApp webhook, whichever provider is in front of it.
 *
 * GET is Meta's one-time verification handshake when the URL is registered:
 * echo the challenge only for our verify token. Twilio does not use it.
 *
 * POST carries delivery statuses and parents' replies, verified by signature
 * before a byte of the body is read as data. The adapter is handed the URL as
 * well as the body because Twilio signs both — the same route serves as its
 * inbound webhook and its status callback.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * A delivery that passed the signature check and yielded nothing.
 *
 * Answering `200` and forgetting it is right — a provider must not retry an
 * event we will never act on — but it is also how a real fault hides. Not one
 * parent reply has ever reached this system, and from the outside a body that
 * arrived and was discarded is indistinguishable from one that was never
 * sent. This is the difference, written down.
 *
 * Keys, never values: `describeWebhookShape` keeps the event name and the
 * field names and drops the rest, so this says which spelling to read without
 * copying a parent's message into the audit trail.
 *
 * One row per event name per hour, because the events we subscribe to and
 * ignore on purpose would otherwise write a row apiece, every time.
 */
async function noteUnrecognised(admin: AdminClient, raw: string): Promise<void> {
  try {
    const shape = describeWebhookShape(raw);
    const label = shape.type ?? (shape.unparsable ? "(unreadable)" : "(no type)");
    const { data: seen } = await admin
      .from("audit_log")
      .select("id")
      .eq("action", "webhook.unrecognised")
      .eq("entity_id", label)
      .gte("occurred_at", new Date(Date.now() - 3_600_000).toISOString())
      .limit(1);
    if ((seen ?? []).length) return;
    await admin.from("audit_log").insert({
      actor_type: "system",
      actor_label: "whatsapp webhook",
      action: "webhook.unrecognised",
      entity_type: "webhook",
      entity_id: label,
      after: shape as unknown as Json,
    });
  } catch (e) {
    // Diagnostics must never cost us a delivery.
    console.warn(`[whatsapp] could not note an unrecognised webhook: ${(e as Error).message}`);
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  const provider = await getMessagingProvider();
  const events = await provider.verifyWebhook(raw, request.headers, request.url);
  if (events === null) return Response.json({ error: "Invalid signature" }, { status: 401 });

  const admin = createAdminClient();
  if (events.length === 0) await noteUnrecognised(admin, raw);

  const summary = await handleInboundEvents(admin, events);
  return Response.json({ received: events.length, ...summary });
}
