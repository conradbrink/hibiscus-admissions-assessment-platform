import { redirect } from "next/navigation";
import { hintFirst } from "@/lib/payments/attempts";
import { fieldMap, parseWire } from "@/lib/payments/paygate-wire";
import { paymentProviderName } from "@/lib/payments/provider";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { readTransportSession } from "@/lib/tokens/server";
import { loadTransportAttempts, transportAttemptByProviderRef, transportClient } from "@/lib/transport/scope";
import { PARENT_ACTOR } from "@/lib/workflow/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the gateway sends a parent back after paying for transport.
 *
 * Nothing in the query string is trusted: the gateway's token only decides
 * which of this booking's attempts to ask about first, and the verdict comes
 * from asking the gateway (`reconcilePayment`). The same shape as the
 * admissions and extras returns.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await readTransportSession();
  if (!session) redirect("/transport?expired=1");
  const admin = transportClient();
  const attempts = await loadTransportAttempts(admin, session);
  const hint = new URL(request.url).searchParams.get("TransactionToken");
  for (const payment of hintFirst(attempts, hint)) {
    try {
      const outcome = await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
      if (outcome === "paid") break;
    } catch (e) {
      console.warn("[transport pay] return verify failed", payment.id, (e as Error).message);
    }
  }
  redirect("/transport/booking");
}

/**
 * PayGate posts the parent back cross-site, without the booking cookie. The
 * payment is found by the request id PayGate posted, among transport attempts
 * only, and verified with PayGate; the parent is then sent to the booking
 * page, where the cookie is present again and decides what they see.
 */
export async function POST(request: Request): Promise<Response> {
  if (paymentProviderName() === "paygate") {
    const m = fieldMap(parseWire(await request.text()));
    const admin = transportClient();
    const payment = await transportAttemptByProviderRef(admin, m.PAY_REQUEST_ID ?? "");
    if (payment) {
      try {
        await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
      } catch (e) {
        console.warn("[transport pay] return verify failed", payment.id, (e as Error).message);
      }
    }
  }
  return Response.redirect(new URL("/transport/booking", request.url), 303);
}
