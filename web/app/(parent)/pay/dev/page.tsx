import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevGatewayScreen } from "@/components/parent/dev-gateway-screen";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { simulateOutcome } from "./actions";

export const metadata: Metadata = { title: "Development gateway" };
// Decided per request from the environment, never baked in at build time.
export const dynamic = "force-dynamic";

/**
 * Stands in for the gateway's hosted page on a laptop, for an admission.
 * Absent in production.
 */
export default async function DevGatewayPage() {
  if (!devGatewayEnabled()) notFound();
  return <DevGatewayScreen action={simulateOutcome} />;
}
