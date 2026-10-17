"use server";

import { redirect } from "next/navigation";
import type { PayState } from "@/app/(parent)/pay/actions";
import { startCheckout } from "@/lib/payments/checkout";
import { canPayOnline, transferOnlyReason } from "@/lib/payments/online";
import { paymentProviderName } from "@/lib/payments/provider";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/tokens";
import { requireTransportSession } from "@/lib/tokens/server";
import { openTransportRequest } from "@/lib/transport/requests";
import { loadSessionBooking, loadTransportAttempts, transportClient } from "@/lib/transport/scope";
import { PARENT_ACTOR, WorkflowError } from "@/lib/workflow/engine";

/**
 * Paying for a booking, and asking again.
 *
 * The booking comes from the session, never from the form; the amount comes
 * from the request, which copied the children's own rows. The gateway is
 * given the booking's reference, so no child's name travels to it or comes
 * back in its replies.
 */

export async function startTransportPayment(): Promise<PayState> {
  const session = await requireTransportSession();
  const admin = transportClient();
  const loaded = await loadSessionBooking(admin, session);
  if (!loaded) redirect("/transport?expired=1");

  const verdict = await enforceRateLimit(admin, LIMITS.paymentStart, loaded.booking.id);
  if (!verdict.ok) return { error: "Please wait a moment before trying again." };
  if (!canPayOnline(paymentProviderName(), "BWP")) return { error: transferOnlyReason("BWP") };

  let redirectUrl: string;
  try {
    const request = await openTransportRequest(admin, { bookingId: loaded.booking.id });
    const started = await startCheckout(admin, {
      request,
      reference: loaded.booking.reference,
      description: `School transport — ${loaded.booking.reference}`,
      customer: { email: loaded.booking.email, firstName: loaded.booking.parent_first_name, lastName: loaded.booking.parent_last_name },
      returnUrl: `${siteUrl()}/transport/pay/return`,
      backUrl: `${siteUrl()}/transport/booking?cancelled=1`,
      // Under /transport, the only path the booking cookie is sent to.
      bridgeBase: "/transport/pay",
      // No engine to tell. The sweep verifies a payment the parent never
      // came back from, so a closed browser is still confirmed.
      onStarted: async () => {},
    });
    redirectUrl = started.redirectUrl;
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    console.error("[transport pay] start failed", e);
    return { error: "We could not start the payment. Please try again in a moment." };
  }
  redirect(redirectUrl);
}

export async function checkTransportPayment(): Promise<PayState> {
  const session = await requireTransportSession();
  const admin = transportClient();
  const verdict = await enforceRateLimit(admin, LIMITS.paymentCheck, session.bookingId);
  if (!verdict.ok) return { error: "Please wait a moment before checking again." };

  const attempts = await loadTransportAttempts(admin, session);
  if (attempts.length === 0) return { error: "We have no record of a payment to check." };
  for (const payment of attempts) {
    try {
      const outcome = await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
      if (outcome === "paid") break;
    } catch (e) {
      console.warn("[transport pay] check failed", payment.id, (e as Error).message);
    }
  }
  redirect("/transport/booking");
}
