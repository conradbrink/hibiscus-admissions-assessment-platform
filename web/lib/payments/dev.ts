import "server-only";
import { randomUUID } from "node:crypto";
import { devShortcutsAllowed } from "@/lib/deployment";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CheckoutRequest, CheckoutResult, PaymentProvider, VerifyResult } from "@/lib/payments/provider";

/**
 * The development gateway. Charges nothing, and cannot report a payment as
 * made unless the "simulate" screen at /pay/dev wrote the outcome onto the
 * payment row first. On any deployment it refuses to exist.
 */

// Not production, and not any other deployment either unless somebody has
// said so: a preview build has no PAYMENT_PROVIDER, so it would otherwise
// fall back to this adapter and be able to report a payment as made. The
// screen is refused by `devGatewayEnabled`; this refuses the adapter behind
// it, so neither half can be reached by the other's mistake.
if (!devShortcutsAllowed()) {
  throw new Error(
    "The development payment gateway cannot run on a deployment. Set PAYMENT_PROVIDER=paygate or dpo for this environment, or ALLOW_DEV_SHORTCUTS=1 if this deployment is deliberately a sandbox."
  );
}

export type DevSimulation = { dev_simulated: "paid" | "failed" | "cancelled"; simulated_at: string };

export const devProvider: PaymentProvider = {
  name: "dev",

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    return {
      providerRef: `dev_${randomUUID()}`,
      // A relative URL: the parent stays on this site, on a page that says
      // in large letters that nothing is being charged.
      redirectUrl: `/pay/dev?ref=${encodeURIComponent(request.reference)}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
  },

  async verify(providerRef: string): Promise<VerifyResult> {
    const admin = createAdminClient();
    const { data } = await admin.from("payments").select("amount_minor, currency, raw_response").eq("provider_ref", providerRef).maybeSingle();
    const sim = (data?.raw_response as Partial<DevSimulation> | null)?.dev_simulated;
    if (!data || !sim) return { status: "pending", amountMinor: null, currency: null, approvalCode: null, raw: { dev: "no simulation recorded" } };
    if (sim === "paid") {
      return { status: "paid", amountMinor: Number(data.amount_minor), currency: data.currency, approvalCode: "DEV-APPROVED", raw: { dev_simulated: sim } };
    }
    return { status: "failed", amountMinor: null, currency: null, approvalCode: null, raw: { dev_simulated: sim } };
  },
};
