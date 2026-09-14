import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { reconcilePayment } from "@/lib/payments/reconcile";
import type { JobRow } from "@/lib/supabase/types";
import { commit, SYSTEM_ACTOR } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

/**
 * Ask the gateway about a processing payment, and keep asking.
 *
 * A gateway that answers "not yet" is not an answer to file and forget. This
 * used to return "done" on a pending reply, and its idempotency key meant no
 * second job could ever be queued — so a payment got exactly one check and
 * then waited out its checkout expiry. The sweep is the backstop; it runs on
 * the cron, which is every five minutes at best.
 *
 * Each pending reply queues the next check a minute out, under a key that
 * carries the attempt number so it is genuinely a new job. "A minute out" is
 * when it becomes due, not when it runs: a job is run by whichever drain
 * comes next — a parent or staff action on its way out, or the five-minute
 * cron — so an unattended payment is checked within five minutes, not one.
 * The chain stops when the payment leaves `processing`, which it will,
 * because the attempt window closes and `reconcilePayment` expires it.
 */
export async function paymentVerifyHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { payment_id?: string; attempt?: number };
  if (!p.payment_id) return { outcome: "failed", error: "payment_verify job missing payment_id", retryable: false };
  const { data: payment } = await admin.from("payments").select("*").eq("id", p.payment_id).maybeSingle();
  if (!payment) return { outcome: "skipped", reason: "payment missing" };
  if (payment.status !== "processing") return { outcome: "skipped", reason: `payment is ${payment.status}` };
  let outcome: "paid" | "pending" | "failed";
  try {
    outcome = await reconcilePayment(admin, payment, SYSTEM_ACTOR);
  } catch (e) {
    return { outcome: "failed", error: (e as Error).message, retryable: true };
  }
  if (outcome !== "pending") return { outcome: "done" };

  // Still pending. Ask again in a minute, unless our own window has closed —
  // in which case the next reconcile would expire it anyway and there is
  // nothing left to wait for. The cap is a backstop against a clock that
  // never advances, not the thing that ends the wait.
  const attempt = (p.attempt ?? 1) + 1;
  const windowOpen = payment.expires_at === null || new Date(payment.expires_at).getTime() > Date.now();
  if (!windowOpen || attempt > MAX_VERIFY_ATTEMPTS) return { outcome: "done" };
  await admin.from("jobs").insert({
    type: "payment_verify",
    application_id: job.application_id,
    payload: { payment_id: payment.id, attempt },
    idempotency_key: `payment_verify:${payment.id}:${attempt}`,
    run_after: new Date(Date.now() + 60_000).toISOString(),
    precondition: { payment_id: payment.id, payment_status: ["processing"] },
  });
  return { outcome: "done" };
}

/** A payment cannot be asked about forever; the attempt window ends it first. */
const MAX_VERIFY_ATTEMPTS = 30;

/** The due date passed with the request still open. A task for a person; the status does not change. */
export async function paymentOverdueHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { payment_request_id?: string };
  if (!p.payment_request_id || !job.application_id) return { outcome: "failed", error: "payment_overdue job missing request or application", retryable: false };
  const { data: request } = await admin.from("payment_requests").select("*").eq("id", p.payment_request_id).maybeSingle();
  if (!request) return { outcome: "skipped", reason: "request missing" };
  if (!["required", "failed", "partially_paid"].includes(request.status)) return { outcome: "skipped", reason: `request is ${request.status}` };
  const { data: app } = await admin.from("applications").select("id, status, child_first_name").eq("id", job.application_id).single();
  if (!app) return { outcome: "skipped", reason: "application missing" };
  if (app.status !== "payment_required") return { outcome: "skipped", reason: `application is ${app.status}` };
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: "payment.overdue", summary: "Payment due date passed", payload: { payment_request_id: request.id } },
    tasks: [
      {
        type: "payment_overdue",
        title: `${app.child_first_name}: fees overdue`,
        details: "The registration and admission fees were not paid by the due date. Call the parent; withdraw the offer if the place is to be released.",
        priority: "high",
      },
    ],
    actor: SYSTEM_ACTOR,
  });
  return { outcome: "done" };
}
