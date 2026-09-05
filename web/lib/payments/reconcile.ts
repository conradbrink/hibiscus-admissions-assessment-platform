import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { amountMatches } from "@/lib/payments/amounts";
import { getPaymentProvider, type VerifyResult } from "@/lib/payments/provider";
import { getSettings } from "@/lib/settings";
import type { Json, PaymentRow } from "@/lib/supabase/types";
import { SYSTEM_ACTOR, WorkflowError, type Actor } from "@/lib/workflow/engine";
import { onPaymentFailed, onPaymentVerified } from "@/lib/workflow/payment-actions";

/**
 * The only place a payment becomes "succeeded" from the gateway's side.
 * Called when the parent returns, by the payment_verify job, and by the
 * sweep the cron runs — all of them idempotent, because the gateway is
 * asked, not told, and a paid answer is applied once.
 */
export async function reconcilePayment(admin: AdminClient, payment: PaymentRow, actor: Actor = SYSTEM_ACTOR): Promise<"paid" | "pending" | "failed"> {
  if (payment.status === "succeeded") return "paid";
  if (payment.status !== "processing" || !payment.provider_ref) return payment.status === "failed" || payment.status === "expired" ? "failed" : "pending";

  const provider = await getPaymentProvider();
  let result: VerifyResult;
  try {
    result = await provider.verify(payment.provider_ref);
  } catch (e) {
    await admin
      .from("payments")
      .update({ verify_attempts: payment.verify_attempts + 1, last_verified_at: new Date().toISOString() })
      .eq("id", payment.id);
    throw new WorkflowError(`verify failed: ${(e as Error).message}`, "database");
  }

  const stamped = {
    verify_attempts: payment.verify_attempts + 1,
    last_verified_at: new Date().toISOString(),
    raw_response: { ...(payment.raw_response && typeof payment.raw_response === "object" && !Array.isArray(payment.raw_response) ? (payment.raw_response as Record<string, Json>) : {}), ...(result.raw && typeof result.raw === "object" && !Array.isArray(result.raw) ? (result.raw as Record<string, Json>) : {}) } as Json,
  };
  await admin.from("payments").update(stamped).eq("id", payment.id);
  const { data: app } = await admin.from("applications").select("*").eq("id", payment.application_id).single();
  const { data: request } = await admin.from("payment_requests").select("*").eq("id", payment.payment_request_id).single();
  if (!app || !request) throw new WorkflowError("payment's application or request missing", "database");

  if (result.status === "paid") {
    if (!amountMatches(payment, result)) {
      // Money moved, but not the amount we asked for. Never "paid": finance looks.
      await onPaymentFailed(admin, app, request, payment, `amount_mismatch: provider says ${result.amountMinor ?? "?"} ${result.currency ?? "?"}`, actor, { review: true });
      return "failed";
    }
    await onPaymentVerified(admin, app, request, payment, { approvalCode: result.approvalCode }, actor);
    return "paid";
  }
  if (result.status === "failed" || result.status === "expired") {
    await onPaymentFailed(admin, app, request, payment, result.status === "expired" ? "expired" : "declined", actor);
    return "failed";
  }
  // Still pending at the gateway. Past our own time limit, give up on it.
  if (payment.expires_at && new Date(payment.expires_at).getTime() < Date.now()) {
    await onPaymentFailed(admin, app, request, payment, "expired", actor);
    return "failed";
  }
  return "pending";
}

/**
 * The sweep: every processing payment not checked within
 * payment_verify_minutes. A parent who paid and closed the browser is
 * confirmed by this within minutes, without a webhook.
 */
export async function reconcileProcessingPayments(admin: AdminClient): Promise<number> {
  const settings = await getSettings(admin);
  const cutoff = new Date(Date.now() - settings.paymentVerifyMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("status", "processing")
    .or(`last_verified_at.is.null,last_verified_at.lt.${cutoff}`)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  let touched = 0;
  for (const payment of data ?? []) {
    try {
      await reconcilePayment(admin, payment);
      touched += 1;
    } catch (e) {
      console.warn("[payments] reconcile failed", payment.id, (e as Error).message);
    }
  }
  return touched;
}
