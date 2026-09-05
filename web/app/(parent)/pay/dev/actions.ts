"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
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
  const session = await requireParentSession();
  const admin = createAdminClient();
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
