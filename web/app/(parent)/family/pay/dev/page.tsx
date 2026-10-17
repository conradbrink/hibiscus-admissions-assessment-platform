import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevGatewayScreen } from "@/components/parent/dev-gateway-screen";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { requireFamilySession } from "@/lib/tokens/server";
import { simulateFamilyOutcome } from "./actions";

export const metadata: Metadata = { title: "Development gateway" };
// Decided per request from the environment, never baked in at build time.
export const dynamic = "force-dynamic";

/**
 * Stands in for the gateway's hosted page on a laptop, for a family paying
 * for extras. Under /family so the family cookie reaches it. Absent in
 * production.
 */
export default async function FamilyDevGatewayPage() {
  if (!devGatewayEnabled()) notFound();
  await requireFamilySession();
  return <DevGatewayScreen action={simulateFamilyOutcome} />;
}
