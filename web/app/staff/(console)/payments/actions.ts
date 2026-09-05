"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { parseMoneyToMinor } from "@/lib/money";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { loadOpenPaymentRequest } from "@/lib/payments/requests";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { WorkflowError } from "@/lib/workflow/engine";
import { onEftRecorded, onPaymentRefunded } from "@/lib/workflow/payment-actions";

/**
 * Finance's three actions. Each reads the application through the caller's
 * client first, so a campus-restricted person cannot act on another school's
 * money by posting an id.
 */

function done(applicationId: string) {
  revalidatePath("/staff/payments");
  revalidatePath(`/staff/applications/${applicationId}`);
  revalidatePath("/staff/tasks");
  revalidatePath("/staff");
}

export async function recordEft(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z
      .object({
        applicationId: z.uuid(),
        amount: z.string().trim().min(1),
        receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        bankReference: z.string().trim().min(2).max(80),
        note: z.string().trim().max(300).optional(),
      })
      .parse(Object.fromEntries(formData));
    const amountMinor = parseMoneyToMinor(p.amount);
    if (amountMinor === null || amountMinor <= 0) throw new WorkflowError(`"${p.amount}" is not an amount.`, "database");
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const request = await loadOpenPaymentRequest(admin, app.id);
    if (!request) throw new WorkflowError("Nothing is outstanding on this application.", "status_conflict");
    const outstanding = Number(request.amount_minor) - Number(request.paid_minor);
    if (amountMinor > outstanding) {
      throw new WorkflowError(`That is more than the ${outstanding / 100} outstanding. Record the outstanding amount and note the overpayment for a refund.`, "database");
    }
    await onEftRecorded(admin, app, request, { amountMinor, receivedOn: p.receivedOn, bankReference: p.bankReference, note: p.note || null }, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

export async function checkWithGateway(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z.object({ applicationId: z.uuid(), paymentId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: payment } = await admin.from("payments").select("*").eq("id", p.paymentId).eq("application_id", app.id).maybeSingle();
    if (!payment) throw new WorkflowError("Payment not found.", "application_not_found");
    const outcome = await reconcilePayment(admin, payment, ctx.actor);
    if (outcome === "pending") throw new WorkflowError("The provider still reports this payment as not completed.", "database");
    drainSoon();
    done(app.id);
  });
}

export async function recordRefund(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z.object({ applicationId: z.uuid(), paymentId: z.uuid(), note: z.string().trim().min(3).max(300) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: payment } = await admin.from("payments").select("*").eq("id", p.paymentId).eq("application_id", app.id).maybeSingle();
    if (!payment) throw new WorkflowError("Payment not found.", "application_not_found");
    await onPaymentRefunded(admin, app, payment, p.note, ctx.actor);
    done(app.id);
  });
}
