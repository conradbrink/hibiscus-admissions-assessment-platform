import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationGraph } from "@/lib/applications";
import { getPaymentProvider } from "@/lib/payments/provider";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";
import { onPaymentStarted } from "@/lib/workflow/payment-actions";

/**
 * Starting an online payment: a pending payment row first (so the reference
 * exists before the gateway hears of it), then the gateway, then the row
 * becomes processing and the engine records the start. If the gateway
 * refuses, the row is marked failed and the application does not move.
 */
export async function startCheckout(
  admin: AdminClient,
  opts: { graph: ApplicationGraph; request: PaymentRequestRow; returnUrl: string; backUrl: string }
): Promise<{ payment: PaymentRow; redirectUrl: string }> {
  const { graph, request } = opts;
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
      application_id: graph.application.id,
      method: "online",
      provider: provider.name,
      company_ref: `${graph.application.reference}-PENDING`,
      amount_minor: outstanding,
      currency: request.currency,
      status: "pending",
    })
    .select("*")
    .single();
  if (error || !pending) throw new WorkflowError(error?.message ?? "payment insert failed", "database");

  const companyRef = `${graph.application.reference}-${pending.id.slice(0, 8).toUpperCase()}`;
  let checkout;
  try {
    checkout = await provider.createCheckout({
      paymentId: pending.id,
      amountMinor: outstanding,
      currency: request.currency,
      reference: companyRef,
      description: `Registration and admission fees — ${graph.application.reference}`,
      returnUrl: opts.returnUrl,
      backUrl: opts.backUrl,
      customer: { email: graph.contact.email, firstName: graph.contact.first_name, lastName: graph.contact.last_name },
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

  await onPaymentStarted(admin, graph.application, request, processing);
  return { payment: processing, redirectUrl: checkout.redirectUrl };
}
