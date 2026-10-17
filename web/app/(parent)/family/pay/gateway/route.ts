import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { processingAttemptForFamily } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { paygateBridgeResponse } from "@/lib/payments/paygate-bridge";
import { paymentProviderName } from "@/lib/payments/provider";
import { requireFamilySession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bridge to PayGate for a family paying for extras.
 *
 * It lives under /family because the family cookie is only sent there. The
 * admissions bridge at /pay/gateway asks for the application cookie, so a
 * family sent there was told their link had expired, and the payment sat
 * processing until it timed out. Only a family whose own child's processing
 * payment carries the request id gets the form.
 */
export async function GET(request: Request): Promise<Response> {
  if (paymentProviderName() !== "paygate") redirect("/family/extras");
  const nonce = (await headers()).get("x-nonce") ?? "";
  const session = await requireFamilySession();
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  const payment = await processingAttemptForFamily(familyClient(), session, ref);
  if (!payment || !payment.provider_ref) redirect("/family/extras");
  return paygateBridgeResponse({ provider_ref: payment.provider_ref, company_ref: payment.company_ref }, nonce);
}
