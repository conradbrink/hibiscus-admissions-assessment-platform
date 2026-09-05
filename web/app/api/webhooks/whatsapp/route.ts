import { createAdminClient } from "@/lib/supabase/admin";
import { handleInboundEvents } from "@/lib/messaging/inbound";
import { getMessagingProvider } from "@/lib/messaging/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta's webhook. GET is the one-time verification handshake when the URL
 * is registered: echo the challenge only for our verify token. POST carries
 * delivery statuses and parents' replies, verified by signature before a
 * byte of the body is read as data.
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

export async function POST(request: Request) {
  const raw = await request.text();
  const provider = await getMessagingProvider();
  const events = await provider.verifyWebhook(raw, request.headers);
  if (events === null) return Response.json({ error: "Invalid signature" }, { status: 401 });

  const summary = await handleInboundEvents(createAdminClient(), events);
  return Response.json({ received: events.length, ...summary });
}
