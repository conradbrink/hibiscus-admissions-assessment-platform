import "server-only";
import { formatMoney } from "@/lib/money";
import { ownerForStudent } from "@/lib/onboarding/owner";
import type { AdminClient } from "@/lib/supabase/admin";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * What happens to an extras order when the money moves.
 *
 * The admissions equivalent (`lib/workflow/payment-actions.ts`) puts everything
 * through `commit()` so the application's status, its timeline and its tasks
 * move together. None of that applies here: the child is already at the school,
 * there is no status to advance, and there is no student timeline to write to —
 * `funnel_events` and `application_events` are both application-scoped, and
 * inventing a third event log to record "a stationery pack was paid for" would
 * be a bigger change than the payment itself.
 *
 * So the trail is the `payments` rows — which carry the provider's answer, the
 * amount, the approval code and every verify attempt — plus the selection lines
 * flipping to `paid`. Anything a person needs to look at becomes a task against
 * the child, assigned to whoever owned their application, which is possible
 * because `tasks.student_id` now exists.
 */

async function childName(admin: AdminClient, studentId: string): Promise<string> {
  const { data } = await admin
    .from("students")
    .select("legal_first_name, preferred_name, current_campus_id")
    .eq("id", studentId)
    .maybeSingle();
  return data ? data.preferred_name || data.legal_first_name : "A child";
}

/**
 * One task about a child's extras order, on the owner's badge where possible.
 * `campus_id` comes from the request rather than the student so the task is
 * scoped to the same campus the money is.
 */
async function taskForStudent(
  admin: AdminClient,
  request: PaymentRequestRow,
  studentId: string,
  task: { type: string; title: string; details: string; priority: "normal" | "high" }
): Promise<void> {
  await admin.from("tasks").insert({
    student_id: studentId,
    campus_id: request.campus_id,
    type: task.type,
    title: task.title,
    details: task.details,
    priority: task.priority,
    assignee_staff_id: await ownerForStudent(admin, studentId),
  });
}

/**
 * A verified payment for an order. Idempotent on the payment row, exactly as
 * the admissions path is: a verify that arrives twice settles once.
 */
export async function onExtrasPaid(
  admin: AdminClient,
  request: PaymentRequestRow,
  payment: PaymentRow,
  result: { approvalCode: string | null }
): Promise<void> {
  const studentId = request.student_id;
  if (!studentId) throw new WorkflowError("This payment request does not name a child.", "status_conflict");

  const { data: settled } = await admin
    .from("payments")
    .update({ status: "succeeded", approval_code: result.approvalCode, failure_reason: null })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");
  if (!settled?.length) return;

  const paidMinor = Number(request.paid_minor) + Number(payment.amount_minor);
  const paidInFull = paidMinor >= Number(request.amount_minor);
  const { error } = await admin
    .from("payment_requests")
    .update({
      paid_minor: paidMinor,
      status: paidInFull ? "paid" : "partially_paid",
      paid_at: paidInFull ? new Date().toISOString() : null,
    })
    .eq("id", request.id);
  if (error) throw new WorkflowError(error.message, "database");

  if (!paidInFull) {
    // A part payment on an order is odd enough to be worth a person's eyes: the
    // school has to decide whether to place the order anyway.
    const name = await childName(admin, studentId);
    const short = formatMoney(Number(request.amount_minor) - paidMinor, request.currency);
    await taskForStudent(admin, request, studentId, {
      type: "extras_shortfall",
      title: `${name}: part payment on the extras order`,
      details: `${formatMoney(Number(payment.amount_minor), payment.currency)} received, ${short} still outstanding. Decide whether to place the order now or wait.`,
      priority: "normal",
    });
    return;
  }

  // Only the lines this request covered, so a line chosen after the request was
  // raised is not marked paid by a payment that never included it.
  const { error: linesErr } = await admin
    .from("student_optional_selections")
    .update({ status: "paid" })
    .eq("payment_request_id", request.id)
    .eq("status", "selected");
  if (linesErr) throw new WorkflowError(linesErr.message, "database");
}

/**
 * The gateway said no, or never said yes in time.
 *
 * The lines go back to `selected` with no request against them, so the family
 * can simply try again from the extras page and a fresh request is raised over
 * the same order. Nothing is chased: these are things the school offers, not
 * things it needs, and a failed stationery payment should not produce a dunning
 * letter.
 */
export async function onExtrasPaymentFailed(
  admin: AdminClient,
  request: PaymentRequestRow,
  payment: PaymentRow,
  reason: string,
  opts: { review?: boolean } = {}
): Promise<void> {
  const studentId = request.student_id;
  if (!studentId) throw new WorkflowError("This payment request does not name a child.", "status_conflict");

  const status = reason === "expired" ? "expired" : "failed";
  const { data: changed } = await admin
    .from("payments")
    .update({ status, failure_reason: reason })
    .eq("id", payment.id)
    .in("status", ["pending", "processing"])
    .select("id");
  if (!changed?.length) return;

  await admin.from("payment_requests").update({ status: "cancelled" }).eq("id", request.id).in("status", ["processing", "required"]);
  await admin
    .from("student_optional_selections")
    .update({ payment_request_id: null })
    .eq("payment_request_id", request.id)
    .eq("status", "selected");

  if (opts.review) {
    // Money moved and it was not the amount asked for. Never silent, whatever
    // the order was for.
    const name = await childName(admin, studentId);
    await taskForStudent(admin, request, studentId, {
      type: "extras_payment_review",
      title: `${name}: extras payment amount does not match — finance to check`,
      details: `The gateway reports a payment whose amount or currency differs from the order (${reason}). Check with the provider before recording anything.`,
      priority: "high",
    });
  }
}
