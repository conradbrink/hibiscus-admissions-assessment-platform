"use server";

import { redirect } from "next/navigation";
import { loadApplicationGraph } from "@/lib/applications";
import { drainSoon } from "@/lib/parent/actions";
import { startCheckout } from "@/lib/payments/checkout";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { loadOpenPaymentRequest } from "@/lib/payments/requests";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/tokens";
import { requireParentSession } from "@/lib/tokens/server";
import { PARENT_ACTOR, WorkflowError } from "@/lib/workflow/engine";

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
      graph,
      request,
      returnUrl: `${siteUrl()}/pay/return`,
      backUrl: `${siteUrl()}/pay?cancelled=1`,
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

export async function checkPayment(): Promise<PayState> {
  const { admin, graph } = await requestForSession();
  const verdict = await enforceRateLimit(admin, LIMITS.paymentCheck, graph.application.id);
  if (!verdict.ok) return { error: "Please wait a moment before checking again." };
  const { data: processing } = await admin
    .from("payments")
    .select("*")
    .eq("application_id", graph.application.id)
    .eq("status", "processing")
    .order("created_at", { ascending: false });
  for (const payment of processing ?? []) {
    try {
      await reconcilePayment(admin, payment, PARENT_ACTOR);
    } catch (e) {
      console.warn("[pay] check failed", payment.id, (e as Error).message);
      return { error: "We could not reach the payment provider just now. Please try again shortly." };
    }
  }
  drainSoon();
  redirect("/pay");
}
