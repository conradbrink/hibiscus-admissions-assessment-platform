import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { paygateBridgeResponse } from "@/lib/payments/paygate-bridge";
import { paymentProviderName } from "@/lib/payments/provider";
import { orderIdForToken } from "@/lib/events/orders";
import { rememberedOrderToken } from "@/lib/events/session";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { readParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The processing payment this browser may be sent to the gateway for, and
 * where to send it back to if there is none: a parent's, found through their
 * session, or an event buyer's, found through the order their browser is
 * paying for (`lib/events/session.ts`). A buyer holds no parent session, and
 * requiring one sent every ticket buyer to "your link has expired". A parent
 * may hold both — a school family buying tickets — so the reference decides
 * which, and each is still scoped to what that browser holds.
 */
async function paymentForThisBrowser(
  admin: AdminClient,
  ref: string
): Promise<{ payment: { provider_ref: string | null; company_ref: string; status: string } | null; fallback: string }> {
  const session = await readParentSession();
  const token = await rememberedOrderToken();
  if (!session && !token) redirect("/link?expired=1");

  if (session) {
    const { data } = await admin
      .from("payments")
      .select("provider_ref, company_ref, status")
      .eq("application_id", session.applicationId)
      .eq("provider_ref", ref)
      .maybeSingle();
    if (data) return { payment: data, fallback: "/pay" };
  }
  const orderId = token ? await orderIdForToken(admin, token) : null;
  if (orderId) {
    const { data } = await admin
      .from("payments")
      .select("provider_ref, company_ref, status")
      .eq("event_order_id", orderId)
      .eq("provider_ref", ref)
      .maybeSingle();
    if (data) return { payment: data, fallback: "/events/return" };
  }
  return { payment: null, fallback: session ? "/pay" : "/events/return" };
}

/**
 * The bridge to PayGate for an applicant or an event buyer. Only the parent
 * or buyer whose processing payment carries the request id gets the form
 * (`lib/payments/paygate-bridge.ts`); anyone else is sent back. A family
 * paying for extras has its own, under `/family`, where its cookie is sent.
 */
export async function GET(request: Request): Promise<Response> {
  if (paymentProviderName() !== "paygate") redirect("/pay");
  const nonce = (await headers()).get("x-nonce") ?? "";
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  const admin = createAdminClient();
  const { payment, fallback } = await paymentForThisBrowser(admin, ref);
  if (!payment || payment.status !== "processing" || !payment.provider_ref) redirect(fallback);
  return paygateBridgeResponse({ provider_ref: payment.provider_ref, company_ref: payment.company_ref }, nonce);
}
