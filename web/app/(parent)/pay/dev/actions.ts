"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { orderIdForToken } from "@/lib/events/orders";
import { rememberedOrderToken } from "@/lib/events/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";

/**
 * The development gateway's only power: writing an outcome onto the
 * session's processing dev payment, which the dev adapter then reports when
 * asked. Refuses to exist in production, like the adapter.
 */

export async function simulateOutcome(formData: FormData): Promise<void> {
  if (!devGatewayEnabled()) redirect("/pay");
  const outcome = z.enum(["paid", "failed", "cancelled"]).parse(formData.get("outcome"));
  const admin = createAdminClient();

  // An event buyer has no parent session: their browser names the order it
  // is paying for instead. A school parent may be both, so the order is
  // asked first and only while it has a checkout open. "Cancelled" is written
  // too, and reads as declined, so the order is released as it would be at a
  // real gateway.
  const token = await rememberedOrderToken();
  const orderId = token ? await orderIdForToken(admin, token) : null;
  if (orderId) {
    const { data: attempt } = await admin
      .from("payments")
      .select("id")
      .eq("event_order_id", orderId)
      .eq("provider", "dev")
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attempt) {
      await admin
        .from("payments")
        .update({ raw_response: { dev_simulated: outcome, simulated_at: new Date().toISOString() } })
        .eq("id", attempt.id);
      redirect("/events/return");
    }
  }

  const session = await requireParentSession();
  const { data: payment } = await admin
    .from("payments")
    .select("id, raw_response")
    .eq("application_id", session.applicationId)
    .eq("provider", "dev")
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment) redirect("/pay");
  if (outcome === "cancelled") redirect("/pay?cancelled=1");
  await admin
    .from("payments")
    .update({ raw_response: { dev_simulated: outcome, simulated_at: new Date().toISOString() } })
    .eq("id", payment.id);
  redirect("/pay/return");
}
