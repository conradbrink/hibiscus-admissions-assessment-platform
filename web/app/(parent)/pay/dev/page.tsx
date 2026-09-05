import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";
import { devGatewayEnabled } from "@/lib/payments/dev-gateway";
import { simulateOutcome } from "./actions";

export const metadata: Metadata = { title: "Development gateway" };
// Decided per request from the environment, never baked in at build time.
export const dynamic = "force-dynamic";

/**
 * Stands in for the gateway's hosted page on a laptop. Nothing is charged;
 * the buttons decide what the dev adapter will say when asked. Absent in
 * production.
 */
export default async function DevGatewayPage() {
  if (!devGatewayEnabled()) notFound();
  return (
    <>
      <div className="mb-6 rounded-2xl border-4 border-dashed border-warning bg-warning/20 p-5">
        <p className="text-lg font-bold">DEVELOPMENT GATEWAY — NOTHING IS CHARGED</p>
        <p className="mt-1 text-sm">This page exists only outside production. Choose what the payment provider should report.</p>
      </div>
      <PageHeader title="Simulate the payment provider" description="On the live site this is DPO Pay's own page." />
      <div className="space-y-3">
        <form action={simulateOutcome}><input type="hidden" name="outcome" value="paid" /><Button type="submit" size="parent" variant="success">Simulate a successful payment</Button></form>
        <form action={simulateOutcome}><input type="hidden" name="outcome" value="failed" /><Button type="submit" size="parent" variant="destructive">Simulate a declined payment</Button></form>
        <form action={simulateOutcome}><input type="hidden" name="outcome" value="cancelled" /><Button type="submit" size="parent" variant="outline">Cancel and go back</Button></form>
      </div>
    </>
  );
}
