"use server";

import { redirect } from "next/navigation";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { devOutcomeSchema, recordDevOutcome } from "@/lib/payments/dev-simulate";
import { requireTransportSession } from "@/lib/tokens/server";
import { latestDevAttemptForSession, transportClient } from "@/lib/transport/scope";

/**
 * The development gateway for a transport booking: writes an outcome onto the
 * booking's processing dev payment, then sends the browser back the way the
 * gateway would. Refuses to exist in production, like the adapter.
 */
export async function simulateTransportOutcome(formData: FormData): Promise<void> {
  if (!devGatewayEnabled()) redirect("/transport/booking");
  const outcome = devOutcomeSchema.parse(formData.get("outcome"));
  const session = await requireTransportSession();
  const admin = transportClient();
  const payment = await latestDevAttemptForSession(admin, session);
  if (!payment) redirect("/transport/booking");
  if (outcome === "cancelled") redirect("/transport/booking?cancelled=1");
  await recordDevOutcome(admin, payment.id, outcome);
  redirect("/transport/pay/return");
}
