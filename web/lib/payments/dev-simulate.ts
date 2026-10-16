import "server-only";
import { z } from "zod";
import type { DevSimulation } from "@/lib/payments/dev";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * The development gateway's only power: writing an outcome onto a processing
 * dev payment, which the dev adapter then reports when asked.
 *
 * Shared by the admissions and family simulate screens. Each finds the
 * payment under its own session first; this only writes the outcome. Both
 * screens refuse to exist unless `devGatewayEnabled()`, and the adapter
 * itself refuses to load on a deployment, so neither half can be reached by
 * the other's mistake.
 */

export const devOutcomeSchema = z.enum(["paid", "failed", "cancelled"]);
export type DevOutcome = z.infer<typeof devOutcomeSchema>;

export async function recordDevOutcome(admin: AdminClient, paymentId: string, outcome: Exclude<DevOutcome, "cancelled">): Promise<void> {
  const simulation: DevSimulation = { dev_simulated: outcome, simulated_at: new Date().toISOString() };
  const { error } = await admin.from("payments").update({ raw_response: simulation }).eq("id", paymentId).eq("provider", "dev");
  if (error) throw new Error(error.message);
}
