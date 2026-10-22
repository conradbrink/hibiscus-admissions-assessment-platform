"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { simulateDevOutcomeForStudent } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { requireFamilySession } from "@/lib/tokens/server";

/**
 * The family's development gateway: writes what the dev adapter will report
 * onto this child's processing dev attempt, then returns the way a gateway
 * would. Refuses to exist in production, like the adapter.
 */
export async function simulateExtrasOutcome(studentId: string, formData: FormData): Promise<void> {
  const back = `/family/extras/pay/${studentId}`;
  if (!devGatewayEnabled()) redirect(back);
  const outcome = z.enum(["paid", "failed", "cancelled"]).parse(formData.get("outcome"));
  if (outcome === "cancelled") redirect(`${back}?cancelled=1`);
  const session = await requireFamilySession();
  let written = false;
  try {
    written = await simulateDevOutcomeForStudent(familyClient(), session, studentId, outcome);
  } catch {
    redirect("/family/extras");
  }
  redirect(written ? `${back}/return` : back);
}
