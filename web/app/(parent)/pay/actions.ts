"use server";

import { redirect } from "next/navigation";
import { loadApplicationGraph } from "@/lib/applications";
import { drainSoon } from "@/lib/parent/actions";
import { ATTEMPT_STATUSES, recentAttemptsSince } from "@/lib/payments/attempts";
import { startCheckout } from "@/lib/payments/checkout";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { loadOpenPaymentRequest } from "@/lib/payments/requests";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/tokens";
import { requireParentSession } from "@/lib/tokens/server";
import { PARENT_ACTOR, WorkflowError } from "@/lib/workflow/engine";
import { onPaymentStarted } from "@/lib/workflow/payment-actions";

/**
 * Paying online and asking for a re-check. The session names the
 * application; the open request is the one for it; the amount is the
 * request's, never the form's.
 */

export type PayState = { error?: string };

async function requestForSession() {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const request = await loadOpenPaymentRequest(admin, graph.application.id);
  return { admin, graph, request };
}

export async function startOnlinePayment(): Promise<PayState> {
  const { admin, graph, request } = await requestForSession();
  if (!request) return { error: "There is nothing to pay right now." };
  if (graph.application.status !== "payment_required") {
    return { error: graph.application.status === "payment_processing" ? "A payment is already being confirmed. Use Check again below." : "This application is not waiting for a payment." };
  }
  const verdict = await enforceRateLimit(admin, LIMITS.paymentStart, graph.application.id);
  if (!verdict.ok) return { error: "Please wait a moment before trying again." };
  let redirectUrl: string;
  try {
    const started = await startCheckout(admin, {
      request,
      reference: graph.application.reference,
      description: `Registration and admission fees — ${graph.application.reference}`,
      customer: { email: graph.contact.email, firstName: graph.contact.first_name, lastName: graph.contact.last_name },
      returnUrl: `${siteUrl()}/pay/return`,
      backUrl: `${siteUrl()}/pay?cancelled=1`,
      // The admissions consequence: the application moves to
      // payment_processing and the verify job is scheduled.
      onStarted: (payment) => onPaymentStarted(admin, graph.application, request, payment),
    });
    redirectUrl = started.redirectUrl;
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    console.error("[pay] start failed", e);
    return { error: "We could not start the payment. Please try again in a moment." };
  }
  drainSoon();
  redirect(redirectUrl);
}

/**
 * "Check again". Every recent attempt is asked about, with `revive`, for the
 * same reason the return route does: the parent pressing this may have
 * finished paying after we stopped waiting, and the page they are on is
 * telling them to pay again.
 */
export async function checkPayment(): Promise<PayState> {
  const { admin, graph } = await requestForSession();
  const verdict = await enforceRateLimit(admin, LIMITS.paymentCheck, graph.application.id);
  if (!verdict.ok) return { error: "Please wait a moment before checking again." };
  const { data: attempts } = await admin
    .from("payments")
    .select("*")
    .eq("application_id", graph.application.id)
    .eq("method", "online")
    .in("status", [...ATTEMPT_STATUSES])
    .not("provider_ref", "is", null)
    .gte("created_at", recentAttemptsSince())
    .order("created_at", { ascending: false })
    .limit(5);
  let paid = false;
  for (const payment of attempts ?? []) {
    try {
      if ((await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true })) === "paid") {
        paid = true;
        break;
      }
    } catch (e) {
      console.warn("[pay] check failed", payment.id, (e as Error).message);
      return { error: "We could not reach the payment provider just now. Please try again shortly." };
    }
  }
  drainSoon();
  // Nothing still in flight and nothing found: say so here, where the button
  // is, rather than reloading a page that looks exactly as it did.
  if (!paid && !(attempts ?? []).some((p) => p.status === "processing")) {
    return { error: "The payment provider has no record of a completed payment for your last attempt. If you did pay, give it a few minutes and check again; otherwise you can pay below." };
  }
  redirect("/pay");
}
