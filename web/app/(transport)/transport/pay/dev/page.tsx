import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevGatewayScreen } from "@/components/parent/dev-gateway-screen";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { requireTransportSession } from "@/lib/tokens/server";
import { simulateTransportOutcome } from "./actions";

export const metadata: Metadata = { title: "Development gateway" };
// Decided per request from the environment, never baked in at build time.
export const dynamic = "force-dynamic";

/** Stands in for the gateway's hosted page on a laptop, for a transport booking. Absent in production. */
export default async function TransportDevGatewayPage() {
  if (!devGatewayEnabled()) notFound();
  await requireTransportSession();
  return <DevGatewayScreen action={simulateTransportOutcome} />;
}
