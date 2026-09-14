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
import { onEftRecorded, onPaymentFailed, onPaymentRefunded } from "@/lib/workflow/payment-actions";

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
        applicationId: z.guid(),
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
    const p = z.object({ applicationId: z.guid(), paymentId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: payment } = await admin.from("payments").select("*").eq("id", p.paymentId).eq("application_id", app.id).maybeSingle();
    if (!payment) throw new WorkflowError("Payment not found.", "application_not_found");
    if (!payment.provider_ref) throw new WorkflowError("The gateway never opened this payment, so there is nothing to ask it about.", "status_conflict");
    // `revive`: staff pressing this on a payment we gave up on is a deliberate
    // ask, and a parent who finished late deserves to have it found.
    const outcome = await reconcilePayment(admin, payment, ctx.actor, { revive: true });
    if (outcome !== "paid") {
      // Read again: the reconcile stamped the gateway's reply on the row, and
      // the copy in hand is from before it was asked.
      const { data: fresh } = await admin.from("payments").select("status, failure_reason, raw_response").eq("id", payment.id).maybeSingle();
      if (fresh?.failure_reason?.startsWith("amount_mismatch")) {
        throw new WorkflowError("The gateway reports a payment for a different amount. A finance review task has been raised; nothing has been recorded as paid.", "database");
      }
      // The gateway's own words where we have them. "NO_TRANS_DATA" means the
      // parent never got as far as paying, which is a different conversation
      // from a card still being authorised — and staff could not tell the two
      // apart when both read "not completed".
      const raw = fresh?.raw_response && typeof fresh.raw_response === "object" && !Array.isArray(fresh.raw_response)
        ? (fresh.raw_response as Record<string, unknown>)
        : {};
      const said = typeof raw.ERROR === "string" && raw.ERROR === "NO_TRANS_DATA"
        ? " The gateway has no record of this payment being started, so the parent most likely left the page before paying."
        : typeof raw.ERROR === "string"
          ? ` The gateway said: ${raw.ERROR}.`
          : "";
      const state = fresh?.status === "processing" ? "still reports this payment as not completed" : `has no completed payment for this ${fresh?.status ?? "given-up"} attempt`;
      throw new WorkflowError(`The provider ${state}.${said}`, "database");
    }
    drainSoon();
    done(app.id);
  });
}

/**
 * Staff give up on an online attempt the gateway has not confirmed.
 *
 * The same move the attempt window makes on a timer, offered as a button,
 * because the timer is not the only reason to stop waiting: a parent who
 * abandoned the card page and then paid by bank transfer has a request stuck
 * in "processing", and while it is, the bank transfer cannot be recorded.
 * Ethan's mother paid; the office could not enter it.
 *
 * Only an online attempt still processing. It goes through `onPaymentFailed`
 * with reason "expired", exactly as the timer does, so the request reopens,
 * the application returns to "payment required", and the timeline says what
 * happened. A payment that later turns out to have landed at the gateway is
 * still found: Check with gateway asks again on an expired row.
 */
export async function markNotCompleted(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z.object({ applicationId: z.guid(), paymentId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: payment } = await admin.from("payments").select("*").eq("id", p.paymentId).eq("application_id", app.id).maybeSingle();
    if (!payment) throw new WorkflowError("Payment not found.", "application_not_found");
    if (payment.status !== "processing") throw new WorkflowError(`This payment is ${payment.status}, not processing.`, "status_conflict");
    if (payment.method !== "online") throw new WorkflowError("Only an online attempt can be marked not completed.", "status_conflict");
    const { data: request } = await admin.from("payment_requests").select("*").eq("id", payment.payment_request_id).maybeSingle();
    if (!request) throw new WorkflowError("This payment's request is missing.", "database");
    await onPaymentFailed(admin, app, request, payment, "expired", ctx.actor);
    drainSoon();
    done(app.id);
  });
}

export async function recordRefund(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z.object({ applicationId: z.guid(), paymentId: z.guid(), note: z.string().trim().min(3).max(300) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: payment } = await admin.from("payments").select("*").eq("id", p.paymentId).eq("application_id", app.id).maybeSingle();
    if (!payment) throw new WorkflowError("Payment not found.", "application_not_found");
    await onPaymentRefunded(admin, app, payment, p.note, ctx.actor);
    done(app.id);
  });
}
