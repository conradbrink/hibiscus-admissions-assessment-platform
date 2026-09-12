import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { getPaymentProvider, type CheckoutRequest } from "@/lib/payments/provider";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * Starting an online payment: a pending payment row first (so the reference
 * exists before the gateway hears of it), then the gateway, then the row
 * becomes processing. If the gateway refuses, the row is marked failed.
 *
 * This deliberately knows nothing about what is being paid for. It used to take
 * an `ApplicationGraph` purely to build a reference, a description and a
 * customer, which meant nothing but an admission could ever be charged — even
 * though the gateways themselves (`provider.ts`) only ever wanted those three
 * strings. The caller supplies them now, and the payment's own subject is
 * copied from its request by trigger, so there is nothing here to pass and
 * nothing to get wrong.
 *
 * `onStarted` is where the consequences live: the admissions path moves the
 * application and schedules the verify job, an extras payment only schedules
 * the verify.
 */
export async function startCheckout(
  admin: AdminClient,
  opts: {
    request: PaymentRequestRow;
    /** What the parent is told to quote, and what the bursar matches on. */
    reference: string;
    description: string;
    customer: CheckoutRequest["customer"];
    returnUrl: string;
    backUrl: string;
    onStarted: (payment: PaymentRow) => Promise<void>;
  }
): Promise<{ payment: PaymentRow; redirectUrl: string }> {
  const { request } = opts;
  if (!["required", "failed", "partially_paid"].includes(request.status)) {
    throw new WorkflowError(`The payment request is ${request.status}`, "status_conflict");
  }
  const outstanding = Number(request.amount_minor) - Number(request.paid_minor);
  if (outstanding <= 0) throw new WorkflowError("Nothing is outstanding on this request", "status_conflict");

  const provider = await getPaymentProvider();
  const { data: pending, error } = await admin
    .from("payments")
    .insert({
      payment_request_id: request.id,
      method: "online",
      provider: provider.name,
      company_ref: `${opts.reference}-PENDING`,
      amount_minor: outstanding,
      currency: request.currency,
      status: "pending",
    })
    .select("*")
    .single();
  if (error || !pending) throw new WorkflowError(error?.message ?? "payment insert failed", "database");

  const companyRef = `${opts.reference}-${pending.id.slice(0, 8).toUpperCase()}`;
  let checkout;
  try {
    checkout = await provider.createCheckout({
      paymentId: pending.id,
      amountMinor: outstanding,
      currency: request.currency,
      reference: companyRef,
      description: opts.description,
      returnUrl: opts.returnUrl,
      backUrl: opts.backUrl,
      customer: opts.customer,
    });
  } catch (e) {
    await admin
      .from("payments")
      .update({ status: "failed", company_ref: companyRef, failure_reason: `gateway: ${(e as Error).message}`.slice(0, 500) })
      .eq("id", pending.id);
    throw new WorkflowError("The payment provider could not start the payment. Please try again in a moment.", "database");
  }

  const { data: processing, error: uErr } = await admin
    .from("payments")
    .update({ status: "processing", company_ref: companyRef, provider_ref: checkout.providerRef, expires_at: checkout.expiresAt.toISOString() })
    .eq("id", pending.id)
    .select("*")
    .single();
  if (uErr || !processing) throw new WorkflowError(uErr?.message ?? "payment update failed", "database");

  await opts.onStarted(processing);
  return { payment: processing, redirectUrl: checkout.redirectUrl };
}
