import "server-only";
import { formatMoney } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { enqueueJobs, WorkflowError } from "@/lib/workflow/engine";

/**
 * What happens to an event order when the money moves.
 *
 * The extras path (`lib/extras/settle.ts`) is the model: there is no
 * application status to advance and no timeline to write to, so the trail is
 * the `payments` rows plus the order turning `paid`, and anything a person
 * should look at becomes a task. An event order is about no applicant and no
 * child, so its tasks are about the campus that took the money, which
 * `tasks_has_a_subject` allows and `tasks_select` already scopes.
 *
 * Paid means the tickets exist: `issue_event_tickets()` numbers them under
 * the event's lock, once. The email is a job, so a provider that is down is
 * retried by the drain rather than lost.
 */

async function campusTask(
  admin: AdminClient,
  request: PaymentRequestRow,
  task: { type: string; title: string; details: string; priority: "normal" | "high" }
): Promise<void> {
  // The assignee is left to `tasks_set_default_assignee`: the campus's owner.
  await admin.from("tasks").insert({ campus_id: request.campus_id, type: task.type, title: task.title, details: task.details, priority: task.priority });
}

async function orderReference(admin: AdminClient, orderId: string): Promise<string> {
  const { data } = await admin.from("event_orders").select("reference").eq("id", orderId).maybeSingle();
  return data?.reference ?? "An event order";
}

/** The job that emails the tickets. Keyed by order, so two verifies send one email. */
export async function queueTicketsEmail(admin: AdminClient, orderId: string, idempotencyKey = `event_tickets:${orderId}`): Promise<void> {
  await enqueueJobs(admin, [
    {
      type: "send_email",
      applicationId: null,
      idempotencyKey,
      payload: { template_key: "event_tickets", event_order_id: orderId },
    },
  ]);
}

/**
 * A verified payment for an order. Idempotent on the payment row, exactly as
 * the other two subjects are: a verify that arrives twice settles once.
 */
export async function onEventOrderPaid(
  admin: AdminClient,
  request: PaymentRequestRow,
  payment: PaymentRow,
  result: { approvalCode: string | null }
): Promise<void> {
  const orderId = request.event_order_id;
  if (!orderId) throw new WorkflowError("This payment request does not name an event order.", "status_conflict");

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
    .update({ status: paidInFull ? "paid" : "partially_paid", paid_minor: paidMinor, paid_at: paidInFull ? new Date().toISOString() : null })
    .eq("id", request.id);
  if (error) throw new WorkflowError(error.message, "database");

  if (!paidInFull) {
    // The gateway is asked for the full amount and the amounts are compared
    // before this runs, so a part payment here is odd enough for a person.
    await campusTask(admin, request, {
      type: "event_payment_shortfall",
      title: `${await orderReference(admin, orderId)}: part payment for event tickets`,
      details: `${formatMoney(Number(payment.amount_minor), payment.currency)} received, ${formatMoney(Number(request.amount_minor) - paidMinor, request.currency)} still outstanding. No tickets have been issued.`,
      priority: "normal",
    });
    return;
  }

  // Paid, whatever we had decided while waiting. A cancelled order is one we
  // stopped waiting for — the buyer was still on their bank's screen — and
  // the money says otherwise. Its tickets are issued even if the event has
  // filled since: the buyer has paid, and a person decides what happens next.
  const { data: before } = await admin.from("event_orders").select("status").eq("id", orderId).single();
  const { error: oErr } = await admin
    .from("event_orders")
    .update({ status: "paid", paid_at: new Date().toISOString(), cancelled_at: null })
    .eq("id", orderId)
    .neq("status", "paid");
  if (oErr) throw new WorkflowError(oErr.message, "database");

  const { error: tErr } = await admin.rpc("issue_event_tickets", { p_order_id: orderId });
  if (tErr) throw new WorkflowError(tErr.message, "database");

  await queueTicketsEmail(admin, orderId);

  if (before?.status === "cancelled") {
    await campusTask(admin, request, {
      type: "event_late_payment",
      title: `${await orderReference(admin, orderId)}: paid after the order was released`,
      details: `The gateway confirmed ${formatMoney(Number(payment.amount_minor), payment.currency)} after we had stopped waiting for it. The tickets were issued and emailed. If the event was full, or the buyer has since paid again, decide whether to refund one of the payments.`,
      priority: "high",
    });
  }
}

/**
 * The gateway said no, or never said yes in time. The order is cancelled, so
 * its places go back on sale; the buyer starts again from the event page.
 */
export async function onEventPaymentFailed(
  admin: AdminClient,
  request: PaymentRequestRow,
  payment: PaymentRow,
  reason: string,
  opts: { review?: boolean } = {}
): Promise<void> {
  const orderId = request.event_order_id;
  if (!orderId) throw new WorkflowError("This payment request does not name an event order.", "status_conflict");

  const status = reason === "expired" ? "expired" : "failed";
  const { data: changed } = await admin
    .from("payments")
    .update({ status, failure_reason: reason })
    .eq("id", payment.id)
    .in("status", ["pending", "processing"])
    .select("id");
  if (changed?.length) {
    await admin.from("payment_requests").update({ status: "cancelled" }).eq("id", request.id).in("status", ["processing", "required"]);
    await admin.from("event_orders").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", orderId).eq("status", "pending");
  } else if (!opts.review || payment.status === "succeeded") {
    return;
  } else {
    // Given up on, asked again, and the gateway now reports money for the
    // wrong amount. Said once.
    await admin.from("payments").update({ failure_reason: reason }).eq("id", payment.id).in("status", ["failed", "expired"]);
    const { count } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("campus_id", request.campus_id)
      .eq("type", "event_payment_review")
      .ilike("title", `${await orderReference(admin, orderId)}:%`)
      .eq("status", "open");
    if (count) return;
  }

  if (opts.review) {
    await campusTask(admin, request, {
      type: "event_payment_review",
      title: `${await orderReference(admin, orderId)}: event payment amount does not match, finance to check`,
      details: `The gateway reports a payment whose amount or currency differs from the order (${reason}). No tickets were issued. Check with the provider before recording anything.`,
      priority: "high",
    });
  }
}
