import { redirect } from "next/navigation";
import { eventPaymentByProviderRef, orderIdForToken, orderPaymentAttempts } from "@/lib/events/orders";
import { rememberedOrderToken } from "@/lib/events/session";
import { drainSoon } from "@/lib/parent/actions";
import { hintFirst } from "@/lib/payments/attempts";
import { fieldMap, parseWire } from "@/lib/payments/paygate-wire";
import { paymentProviderName } from "@/lib/payments/provider";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { PARENT_ACTOR } from "@/lib/workflow/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the gateway sends a buyer back.
 *
 * Nothing in the request is trusted for the verdict. The browser's order
 * cookie says which order to ask about; the gateway's token, when it sends
 * one, only decides which attempt is asked first. The answer comes from
 * asking the gateway, in `reconcilePayment`, and the buyer is then shown
 * their tickets — or that we are still waiting — on the order's own page.
 *
 * A browser with no cookie (a different browser, or one that dropped it)
 * still gets a page that makes sense: the email is on its way either way,
 * because the notify post and the sweep confirm a payment without the buyer.
 */
export async function GET(request: Request): Promise<Response> {
  const token = await rememberedOrderToken();
  const admin = createAdminClient();
  const orderId = token ? await orderIdForToken(admin, token) : null;
  if (!token || !orderId) redirect("/events/thanks");

  const hint = new URL(request.url).searchParams.get("TransactionToken");
  for (const payment of hintFirst(await orderPaymentAttempts(admin, orderId), hint)) {
    try {
      if ((await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true })) === "paid") break;
    } catch (e) {
      console.warn("[events] return verify failed", payment.id, (e as Error).message);
    }
  }
  // The tickets email was queued by the settle step; send it now rather than
  // at the next scheduled drain.
  drainSoon();
  redirect(`/events/tickets/${token}`);
}

/**
 * PayGate sends the buyer back with a cross-site POST, which arrives without
 * the cookie. So the payment is found by the request id PayGate posted, and
 * only among event orders' attempts; it is verified, and the buyer is sent on
 * to the GET above, where the cookie is present again.
 */
export async function POST(request: Request): Promise<Response> {
  if (paymentProviderName() === "paygate") {
    const m = fieldMap(parseWire(await request.text()));
    const admin = createAdminClient();
    const payment = await eventPaymentByProviderRef(admin, m.PAY_REQUEST_ID ?? "");
    if (payment) {
      try {
        await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
        drainSoon();
      } catch (e) {
        console.warn("[events] return verify failed", payment.id, (e as Error).message);
      }
    }
  }
  return Response.redirect(new URL("/events/return", request.url), 303);
}
