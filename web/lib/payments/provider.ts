import "server-only";
import type { Json } from "@/lib/supabase/types";

/**
 * The one seam every payment goes through. Three adapters: PayGate (the
 * school's gateway) and DPO Pay for production, and a development one that
 * charges nothing and can never
 * report a payment as made on its own. Chosen by PAYMENT_PROVIDER; unset
 * means dev, so a misconfigured deploy cannot take money — or claim to.
 *
 * Nothing outside lib/payments knows a provider's name or wire format.
 */

export type CheckoutRequest = {
  paymentId: string;
  amountMinor: number;
  currency: "BWP" | "ZAR";
  /** Our reference, shown to the parent and sent to the gateway. */
  reference: string;
  description: string;
  returnUrl: string;
  backUrl: string;
  customer: { email: string; firstName: string; lastName: string };
};

export type CheckoutResult = {
  providerRef: string;
  redirectUrl: string;
  expiresAt: Date;
};

export type VerifyStatus = "paid" | "pending" | "failed" | "expired";

export type VerifyResult = {
  status: VerifyStatus;
  amountMinor: number | null;
  currency: string | null;
  approvalCode: string | null;
  /** The parsed fields only, for payments.raw_response. Never a card number. */
  raw: Json;
};

export interface PaymentProvider {
  readonly name: "dev" | "dpo" | "paygate";
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  verify(providerRef: string): Promise<VerifyResult>;
}

/** How long a hosted checkout stays open. */
export const CHECKOUT_TTL_HOURS = 24;

export function paymentProviderName(): "dev" | "dpo" | "paygate" {
  const which = process.env.PAYMENT_PROVIDER ?? "dev";
  if (which === "paygate") return "paygate";
  if (which === "dpo") return "dpo";
  if (which === "dev") return "dev";
  throw new Error(`PAYMENT_PROVIDER "${which}" is not one of dev, dpo, paygate.`);
}

export async function getPaymentProvider(): Promise<PaymentProvider> {
  const which = paymentProviderName();
  if (which === "paygate") {
    const { paygateProvider } = await import("@/lib/payments/paygate");
    return paygateProvider;
  }
  if (which === "dpo") {
    const { dpoProvider } = await import("@/lib/payments/dpo");
    return dpoProvider;
  }
  const { devProvider } = await import("@/lib/payments/dev");
  return devProvider;
}
