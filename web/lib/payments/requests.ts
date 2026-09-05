import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { feeSnapshotFrom } from "@/lib/offers/snapshot";
import type { ApplicationRow, Json, OfferRow, PaymentRequestRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * What a family owes to secure the place: the offer's payable-on-acceptance
 * lines, copied at acceptance so a later fee change cannot alter it.
 */

export const OPEN_REQUEST_STATUSES = ["required", "processing", "failed", "partially_paid"] as const;

export function payableLines(offer: Pick<OfferRow, "fees">) {
  const snapshot = feeSnapshotFrom(offer.fees);
  if (!snapshot) return null;
  return {
    currency: snapshot.currency,
    lines: snapshot.lines.filter((l) => l.payable_at_acceptance).map((l) => ({ code: l.code, label: l.label, amount_minor: l.amount_minor })),
    amountMinor: snapshot.payable_at_acceptance_minor,
  };
}

export async function createPaymentRequest(
  admin: AdminClient,
  opts: { app: Pick<ApplicationRow, "id">; offer: Pick<OfferRow, "id" | "fees" | "currency">; acceptanceId: string; dueAt: Date }
): Promise<PaymentRequestRow> {
  const payable = payableLines(opts.offer);
  if (!payable || payable.amountMinor <= 0) {
    throw new WorkflowError("This offer has no fees payable on acceptance; finance must set a fee schedule before it can be accepted.", "status_conflict");
  }
  const { data, error } = await admin
    .from("payment_requests")
    .insert({
      application_id: opts.app.id,
      offer_id: opts.offer.id,
      acceptance_id: opts.acceptanceId,
      currency: payable.currency,
      amount_minor: payable.amountMinor,
      lines: payable.lines as unknown as Json,
      due_at: opts.dueAt.toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) throw new WorkflowError(error?.message ?? "payment request insert failed", "database");
  return data;
}

export async function loadOpenPaymentRequest(admin: AdminClient, applicationId: string): Promise<PaymentRequestRow | null> {
  const { data, error } = await admin
    .from("payment_requests")
    .select("*")
    .eq("application_id", applicationId)
    .in("status", [...OPEN_REQUEST_STATUSES])
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return data;
}

/** The latest request of any status: what the parent's page and the receipt show after payment. */
export async function loadLatestPaymentRequest(admin: AdminClient, applicationId: string): Promise<PaymentRequestRow | null> {
  const { data, error } = await admin
    .from("payment_requests")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return data;
}

export type PaymentLine = { code: string; label: string; amount_minor: number };

export function requestLines(request: Pick<PaymentRequestRow, "lines">): PaymentLine[] {
  return Array.isArray(request.lines)
    ? request.lines.flatMap((l) => {
        const r = l as Record<string, Json | undefined>;
        return typeof r.code === "string" && typeof r.label === "string" && typeof r.amount_minor === "number"
          ? [{ code: r.code, label: r.label, amount_minor: r.amount_minor }]
          : [];
      })
    : [];
}
