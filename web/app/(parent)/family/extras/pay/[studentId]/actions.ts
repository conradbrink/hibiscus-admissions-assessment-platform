"use server";

import { redirect } from "next/navigation";
import type { PayState } from "@/app/(parent)/pay/actions";
import { openExtrasRequest } from "@/lib/extras/requests";
import { loadStudentOrder, loadStudentProcessingPayments, payerForFamily } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { startCheckout } from "@/lib/payments/checkout";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { paymentReferenceFor } from "@/lib/payments/reference";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/tokens";
import { requireFamilySession } from "@/lib/tokens/server";
import { PARENT_ACTOR, WorkflowError } from "@/lib/workflow/engine";

/**
 * Paying for one child's extras, and asking for a re-check.
 *
 * The child comes from the URL and is checked against the session before
 * anything else happens; the amount comes from the request, which was priced
 * from the lines the family had already chosen. Nothing in the form carries a
 * figure, because nothing in the form is trusted.
 *
 * The rate limits are the admissions ones. A parent is a parent whether they
 * are paying an admission fee or a lunch plan, and a second bucket would only
 * be a second thing to tune.
 */

export async function startExtrasPayment(studentId: string): Promise<PayState> {
  const session = await requireFamilySession();
  const admin = familyClient();

  let order;
  try {
    order = await loadStudentOrder(admin, session, studentId);
  } catch {
    return { error: "That child is not on your family record." };
  }

  const verdict = await enforceRateLimit(admin, LIMITS.paymentStart, order.student.id);
  if (!verdict.ok) return { error: "Please wait a moment before trying again." };

  let redirectUrl: string;
  try {
    // Raised now rather than when the family chose, so it prices exactly what
    // is outstanding at the moment they decide to pay. Returns the open one if
    // they have already started.
    const request = await openExtrasRequest(admin, { studentId: order.student.id });
    const name = order.student.preferred_name || order.student.legal_first_name;
    const started = await startCheckout(admin, {
      request,
      reference: paymentReferenceFor(order.student.legal_first_name, order.student.legal_last_name),
      description: `Optional extras — ${name}`,
      customer: await payerForFamily(admin, session),
      returnUrl: `${siteUrl()}/family/extras/pay/${order.student.id}/return`,
      backUrl: `${siteUrl()}/family/extras/pay/${order.student.id}?cancelled=1`,
      // No status to move and no application timeline to write to, so the only
      // consequence is the verify the reconciler will do anyway. The sweep
      // (`reconcileProcessingPayments`) picks this up within
      // payment_verify_minutes, so a parent who closes the browser is still
      // confirmed.
      onStarted: async () => {},
    });
    redirectUrl = started.redirectUrl;
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    console.error("[extras pay] start failed", e);
    return { error: "We could not start the payment. Please try again in a moment." };
  }
  redirect(redirectUrl);
}

export async function checkExtrasPayment(studentId: string): Promise<PayState> {
  const session = await requireFamilySession();
  const admin = familyClient();

  let processing;
  try {
    processing = await loadStudentProcessingPayments(admin, session, studentId);
  } catch {
    return { error: "That child is not on your family record." };
  }

  const verdict = await enforceRateLimit(admin, LIMITS.paymentCheck, studentId);
  if (!verdict.ok) return { error: "Please wait a moment before checking again." };

  for (const payment of processing) {
    try {
      await reconcilePayment(admin, payment, PARENT_ACTOR);
    } catch (e) {
      console.warn("[extras pay] check failed", payment.id, (e as Error).message);
      return { error: "We could not reach the payment provider just now. Please try again shortly." };
    }
  }
  redirect(`/family/extras/pay/${studentId}`);
}
