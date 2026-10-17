import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { paygateBridgeResponse } from "@/lib/payments/paygate-bridge";
import { paymentProviderName } from "@/lib/payments/provider";
import { requireTransportSession } from "@/lib/tokens/server";
import { processingAttemptForSession, transportClient } from "@/lib/transport/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bridge to PayGate for a transport booking. Under /transport, because
 * that is the only path the booking cookie is sent to. Only the browser whose
 * own booking's processing payment carries the request id gets the form.
 */
export async function GET(request: Request): Promise<Response> {
  if (paymentProviderName() !== "paygate") redirect("/transport/booking");
  const nonce = (await headers()).get("x-nonce") ?? "";
  const session = await requireTransportSession();
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  const payment = await processingAttemptForSession(transportClient(), session, ref);
  if (!payment || !payment.provider_ref) redirect("/transport/booking");
  return paygateBridgeResponse({ provider_ref: payment.provider_ref, company_ref: payment.company_ref }, nonce);
}
