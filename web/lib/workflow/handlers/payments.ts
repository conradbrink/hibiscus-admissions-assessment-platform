import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { reconcilePayment } from "@/lib/payments/reconcile";
import type { JobRow } from "@/lib/supabase/types";
import { commit, SYSTEM_ACTOR } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

/** Ask the gateway about a processing payment. The sweep does the same on a schedule; this is the prompt first check. */
export async function paymentVerifyHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { payment_id?: string };
  if (!p.payment_id) return { outcome: "failed", error: "payment_verify job missing payment_id", retryable: false };
  const { data: payment } = await admin.from("payments").select("*").eq("id", p.payment_id).maybeSingle();
  if (!payment) return { outcome: "skipped", reason: "payment missing" };
  if (payment.status !== "processing") return { outcome: "skipped", reason: `payment is ${payment.status}` };
  try {
    await reconcilePayment(admin, payment, SYSTEM_ACTOR);
    return { outcome: "done" };
  } catch (e) {
    return { outcome: "failed", error: (e as Error).message, retryable: true };
  }
}

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
