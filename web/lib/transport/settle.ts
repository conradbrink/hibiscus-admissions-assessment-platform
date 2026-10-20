import "server-only";
import { formatMoney } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { enqueueJobs, WorkflowError } from "@/lib/workflow/engine";

/**
 * What happens to a transport booking when the money moves.
 *
 * The same shape as the extras settlement (`lib/extras/settle.ts`): there is
 * no engine and no timeline, so the trail is the `payments` rows, the request
 * and the booking's own status, and anything a person must look at becomes a
 * task. Two differences:
 *
 *   * A booking's children are fixed, so a failed attempt leaves the request
 *     open (`failed`) for the parent to try again, rather than releasing the
 *     lines the way an extras order does.
 *   * The booking's status is guarded in the database
 *     (`transport_bookings_guard_status`): it reaches `paid` only once the
 *     request has, which is what this file does in that order.
 *
 * Tasks name the booking's reference and the amounts, never a child: a task is
 * readable by admissions staff at the campus it is filed under.
 */

async function taskForBooking(
  admin: AdminClient,
  request: PaymentRequestRow,
  bookingId: string,
  task: { type: string; title: string; details: string; priority: "normal" | "high" }
): Promise<void> {
  const { error } = await admin.from("tasks").insert({
    transport_booking_id: bookingId,
    campus_id: request.campus_id,
    type: task.type,
    title: task.title,
    details: task.details,
    priority: task.priority,
  });
  if (error) throw new WorkflowError(error.message, "database");
}

async function bookingReference(admin: AdminClient, bookingId: string): Promise<string> {
  const { data } = await admin.from("transport_bookings").select("reference").eq("id", bookingId).maybeSingle();
  return data?.reference ?? "A transport booking";
}

/**
 * A verified payment. Idempotent on the payment row, as the other two are: a
 * verify that arrives twice settles once.
 */
export async function onTransportPaid(
  admin: AdminClient,
  request: PaymentRequestRow,
  payment: PaymentRow,
  result: { approvalCode: string | null }
): Promise<void> {
  const bookingId = request.transport_booking_id;
  if (!bookingId) throw new WorkflowError("This payment request does not name a transport booking.", "status_conflict");

  const { data: settled } = await admin
    .from("payments")
    .update({ status: "succeeded", approval_code: result.approvalCode, failure_reason: null })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");
  if (!settled?.length) return;

  const wasPaid = request.status === "paid";
  const paidMinor = Number(request.paid_minor) + Number(payment.amount_minor);
  const paidInFull = paidMinor >= Number(request.amount_minor);
  const { error } = await admin
    .from("payment_requests")
    .update({
      paid_minor: paidMinor,
      status: paidInFull ? "paid" : "partially_paid",
      paid_at: paidInFull ? (request.paid_at ?? new Date().toISOString()) : null,
    })
    .eq("id", request.id);
  if (error) throw new WorkflowError(error.message, "database");

  const reference = await bookingReference(admin, bookingId);

  if (wasPaid) {
    // Two attempts on one request, both confirmed: the parent paid twice.
    await taskForBooking(admin, request, bookingId, {
      type: "transport_double_payment",
      title: `${reference}: paid twice`,
      details: `A second payment of ${formatMoney(Number(payment.amount_minor), payment.currency)} was confirmed for a booking already paid. Refund one of them through the gateway's portal.`,
      priority: "high",
    });
    return;
  }

  if (!paidInFull) {
    await taskForBooking(admin, request, bookingId, {
      type: "transport_shortfall",
      title: `${reference}: part payment`,
      details: `${formatMoney(Number(payment.amount_minor), payment.currency)} received, ${formatMoney(Number(request.amount_minor) - paidMinor, request.currency)} still outstanding. The children are not on the rider list until it is paid in full.`,
      priority: "normal",
    });
    return;
  }

  const { data: booking, error: bErr } = await admin.from("transport_bookings").select("status, email_normalised, period_id").eq("id", bookingId).single();
  if (bErr || !booking) throw new WorkflowError(bErr?.message ?? "transport booking missing", "database");

  if (booking.status === "cancelled") {
    // Money for a booking the school had already cancelled: the parent
    // finished paying after the office gave up on it. The money is real, so
    // the request says paid, and so does the booking's `paid_at` (its status
    // stays cancelled): that is what lets finance record the refund on the
    // booking page and what puts the money in the earnings until they do.
    // The place is a person's decision.
    const { error: pErr } = await admin.from("transport_bookings").update({ paid_at: new Date().toISOString() }).eq("id", bookingId).is("paid_at", null);
    if (pErr) throw new WorkflowError(pErr.message, "database");
    await taskForBooking(admin, request, bookingId, {
      type: "transport_late_payment",
      title: `${reference}: paid after it was cancelled`,
      details: `${formatMoney(Number(payment.amount_minor), payment.currency)} was confirmed for a cancelled booking. Contact the parent: book the children again, or refund and record the refund on the booking page.`,
      priority: "high",
    });
    return;
  }
  if (booking.status === "expired" || booking.status === "abandoned") {
    // The parent was told this booking had lapsed and to book again. If they
    // did, the money arriving now may be a second payment for the same
    // children: both bookings would ride, and the parent would have paid twice.
    const { data: others, error: oErr } = await admin
      .from("transport_bookings")
      .select("reference")
      .eq("email_normalised", booking.email_normalised)
      .eq("period_id", booking.period_id)
      .in("status", ["awaiting_payment", "paid"])
      .neq("id", bookingId);
    if (oErr) throw new WorkflowError(oErr.message, "database");
    if (others?.length) {
      await taskForBooking(admin, request, bookingId, {
        type: "transport_possible_duplicate",
        title: `${reference}: paid after it expired, and booked again`,
        details: `${formatMoney(Number(payment.amount_minor), payment.currency)} was confirmed after this booking expired. The same email also has ${others.map((o) => o.reference).join(", ")} for the same period. Check with the parent whether the children are booked twice; cancel the one they do not need and refund it.`,
        priority: "high",
      });
    }
  }
  if (booking.status !== "paid") {
    // From awaiting payment, and from expired or abandoned too: a parent who
    // finished on their bank's screen after the booking expired still rides.
    const { error: uErr } = await admin.from("transport_bookings").update({ status: "paid" }).eq("id", bookingId).neq("status", "paid");
    if (uErr) throw new WorkflowError(uErr.message, "database");
  }

  await enqueueJobs(admin, [
    {
      type: "send_transport_email",
      payload: { transport_booking_id: bookingId, template_key: "transport_paid", payment_id: payment.id },
      idempotencyKey: `transport_paid:${payment.id}`,
      applicationId: null,
    },
  ]);
}

/**
 * A settlement that stopped part way. `onTransportPaid` marks the payment
 * succeeded first, which is what stops a second verify settling it twice, and
 * then writes the request, the booking and the email one statement at a time.
 * If one of those fails, nothing asks about that payment again
 * (`reconcilePayment` returns early for a succeeded one), and the booking
 * would wait as unpaid until the sweep expired it: a parent who paid, with no
 * place and no receipt.
 *
 * So the sweep hands each such booking here first. Only the plain case is
 * finished, a booking still awaiting payment whose request its succeeded
 * payments cover; a part payment has its own task for a person. Every write is
 * conditional or keyed, so this changes nothing a settlement still running
 * would not have changed itself. True when the booking is now paid.
 */
export async function finishInterruptedTransportSettlement(admin: AdminClient, bookingId: string): Promise<boolean> {
  const { data: succeeded, error } = await admin
    .from("payments")
    .select("id, payment_request_id, amount_minor")
    .eq("transport_booking_id", bookingId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: true });
  if (error) throw new WorkflowError(error.message, "database");
  const last = succeeded?.at(-1);
  if (!last) return false;

  const { data: request, error: rErr } = await admin.from("payment_requests").select("*").eq("id", last.payment_request_id).single();
  if (rErr || !request) throw new WorkflowError(rErr?.message ?? "payment's request missing", "database");
  const paidMinor = (succeeded ?? []).filter((p) => p.payment_request_id === request.id).reduce((sum, p) => sum + Number(p.amount_minor), 0);
  if (paidMinor < Number(request.amount_minor)) return false;

  if (request.status !== "paid") {
    const { error: uErr } = await admin
      .from("payment_requests")
      .update({ paid_minor: paidMinor, status: "paid", paid_at: request.paid_at ?? new Date().toISOString() })
      .eq("id", request.id)
      .neq("status", "paid");
    if (uErr) throw new WorkflowError(uErr.message, "database");
  }
  const { data: changed, error: bErr } = await admin
    .from("transport_bookings")
    .update({ status: "paid" })
    .eq("id", bookingId)
    .eq("status", "awaiting_payment")
    .select("id");
  if (bErr) throw new WorkflowError(bErr.message, "database");
  if (!changed?.length) return false;

  // The key `onTransportPaid` uses, so a settlement that did queue it sends one.
  await enqueueJobs(admin, [
    {
      type: "send_transport_email",
      payload: { transport_booking_id: bookingId, template_key: "transport_paid", payment_id: last.id },
      idempotencyKey: `transport_paid:${last.id}`,
      applicationId: null,
    },
  ]);
  return true;
}

/**
 * The gateway said no, or never said yes in time. The request stays open as
 * `failed`, so the payment page offers Pay again over the same children.
 */
export async function onTransportPaymentFailed(
  admin: AdminClient,
  request: PaymentRequestRow,
  payment: PaymentRow,
  reason: string,
  opts: { review?: boolean } = {}
): Promise<void> {
  const bookingId = request.transport_booking_id;
  if (!bookingId) throw new WorkflowError("This payment request does not name a transport booking.", "status_conflict");

  const status = reason === "expired" ? "expired" : "failed";
  const { data: changed } = await admin
    .from("payments")
    .update({ status, failure_reason: reason })
    .eq("id", payment.id)
    .in("status", ["pending", "processing"])
    .select("id");
  if (changed?.length) {
    await admin.from("payment_requests").update({ status: "failed" }).eq("id", request.id).in("status", ["required", "processing"]);
  } else if (!opts.review || payment.status === "succeeded") {
    return;
  } else {
    // Given up on, asked again, and the gateway now reports money for the
    // wrong amount. Said once.
    await admin.from("payments").update({ failure_reason: reason }).eq("id", payment.id).in("status", ["failed", "expired"]);
    const { count } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("transport_booking_id", bookingId)
      .eq("type", "transport_payment_review")
      .eq("status", "open");
    if (count) return;
  }

  if (opts.review) {
    const reference = await bookingReference(admin, bookingId);
    await taskForBooking(admin, request, bookingId, {
      type: "transport_payment_review",
      title: `${reference}: payment amount does not match — finance to check`,
      details: `The gateway reports a payment whose amount or currency differs from the booking (${reason}). Check with the provider before recording anything.`,
      priority: "high",
    });
  }
}
