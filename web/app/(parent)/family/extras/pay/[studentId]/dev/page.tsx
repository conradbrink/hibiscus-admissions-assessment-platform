import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevGatewayScreen } from "@/components/parent/dev-gateway-screen";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { simulateExtrasOutcome } from "./actions";

export const metadata: Metadata = { title: "Development gateway" };
// Decided per request from the environment, never baked in at build time.
export const dynamic = "force-dynamic";

/**
 * The development gateway for a family paying for one child's extras: the
 * applicant's screen, under `/family` so the family's cookie comes with it.
 * Absent in production.
 */
export default async function FamilyDevGatewayPage({ params }: { params: Promise<{ studentId: string }> }) {
  if (!devGatewayEnabled()) notFound();
  const { studentId } = await params;
  return <DevGatewayScreen action={simulateExtrasOutcome.bind(null, studentId)} />;
}
