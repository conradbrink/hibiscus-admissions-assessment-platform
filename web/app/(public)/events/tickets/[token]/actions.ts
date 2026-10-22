"use server";

import { revalidatePath } from "next/cache";
import { loadOrderByToken, orderPaymentAttempts } from "@/lib/events/orders";
import { drainSoon } from "@/lib/parent/actions";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { PARENT_ACTOR } from "@/lib/workflow/engine";

export type CheckState = { error?: string };

/**
 * "Check again": ask the gateway about this order's recent attempts, the ones
 * we gave up on included, exactly as the parent pages do. The link names the
 * order; nothing else from the browser is read.
 */
export async function checkOrderPayment(token: string): Promise<CheckState> {
  const admin = createAdminClient();
  const view = await loadOrderByToken(admin, token);
  if (!view) return { error: "We could not find this order." };
  const verdict = await enforceRateLimit(admin, LIMITS.paymentCheck, view.order.id);
  if (!verdict.ok) return { error: "Please wait a moment before checking again." };

  for (const payment of await orderPaymentAttempts(admin, view.order.id)) {
    try {
      if ((await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true })) === "paid") break;
    } catch (e) {
      console.warn("[events] check failed", payment.id, (e as Error).message);
      return { error: "We could not reach the payment provider just now. Please try again shortly." };
    }
  }
  drainSoon();
  revalidatePath(`/events/tickets/${token}`);
  return {};
}
