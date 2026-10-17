import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { paygateBridgeResponse } from "@/lib/payments/paygate-bridge";
import { paymentProviderName } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bridge to PayGate for an admission. Only the parent whose processing
 * payment carries the request id gets the form; anyone else is sent back to
 * the payment page. A family paying for extras has its own bridge under
 * `/family/pay/gateway`, because the family cookie is never sent here.
 */
export async function GET(request: Request): Promise<Response> {
  if (paymentProviderName() !== "paygate") redirect("/pay");
  const nonce = (await headers()).get("x-nonce") ?? "";
  const session = await requireParentSession();
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("provider_ref, company_ref, status")
    .eq("application_id", session.applicationId)
    .eq("provider_ref", ref)
    .maybeSingle();
  if (!payment || payment.status !== "processing" || !payment.provider_ref) redirect("/pay");
  return paygateBridgeResponse({ provider_ref: payment.provider_ref, company_ref: payment.company_ref }, nonce);
}
