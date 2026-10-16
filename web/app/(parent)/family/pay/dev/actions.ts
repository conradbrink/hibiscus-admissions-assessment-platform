"use server";

import { redirect } from "next/navigation";
import { latestDevAttemptForFamily } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { devOutcomeSchema, recordDevOutcome } from "@/lib/payments/dev-simulate";
import { requireFamilySession } from "@/lib/tokens/server";

/**
 * The development gateway for a family's extras: writes an outcome onto the
 * family's processing dev payment, then sends them back the way the gateway
 * would. Refuses to exist in production, like the adapter.
 */
export async function simulateFamilyOutcome(formData: FormData): Promise<void> {
  if (!devGatewayEnabled()) redirect("/family/extras");
  const outcome = devOutcomeSchema.parse(formData.get("outcome"));
  const session = await requireFamilySession();
  const admin = familyClient();
  const payment = await latestDevAttemptForFamily(admin, session);
  if (!payment || !payment.student_id) redirect("/family/extras");
  if (outcome === "cancelled") redirect(`/family/extras/pay/${payment.student_id}?cancelled=1`);
  await recordDevOutcome(admin, payment.id, outcome);
  redirect(`/family/extras/pay/${payment.student_id}/return`);
}
