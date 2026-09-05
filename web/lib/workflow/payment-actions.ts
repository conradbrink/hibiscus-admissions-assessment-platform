import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import type { ApplicationRow, Json, PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { commit, WorkflowError, type Actor, type JobSpec, type TaskSpec } from "@/lib/workflow/engine";

/**
 * Everything that happens to a payment goes through here so the
 * application's status, the timeline, the tasks and the audit trail move
 * with the money. Nothing here talks to a gateway: `lib/payments/reconcile`
 * asks the gateway and calls in with the answer.
 *
 * The milestone event `payment.confirmed` is what the analytics view reads
 * for "paid at"; it is emitted exactly once per request, when the request
 * is settled in full.
 */

const DAY = 86_400_000;

function due(request: Pick<PaymentRequestRow, "due_at">): Date {
  return new Date(request.due_at);
}

/** An online checkout has begun: the parent is on the gateway's page. */
export async function onPaymentStarted(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  request: PaymentRequestRow,
  payment: PaymentRow
): Promise<void> {
  const settings = await getSettings(admin);
  await admin.from("payment_requests").update({ status: "processing" }).eq("id", request.id).in("status", ["required", "failed", "partially_paid"]);
  const verify: JobSpec = {
    type: "payment_verify",
    payload: { payment_id: payment.id },
    idempotencyKey: `payment_verify:${payment.id}`,
    runAfter: new Date(Date.now() + settings.paymentVerifyMinutes * 60_000),
    precondition: { payment_id: payment.id, payment_status: ["processing"] },
  };
  const event = {
    type: "payment.started",
    summary: `Online payment started (${payment.provider}, ${formatMoney(Number(payment.amount_minor), payment.currency)})`,
    payload: { payment_id: payment.id, payment_request_id: request.id, provider: payment.provider },
  };
  if (app.status === "payment_required") {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: "payment_required",
      newStatus: "payment_processing",
      nextAction: "pay_fees",
      nextActionDueAt: due(request),
      event,
      jobs: [verify],
      actor: { type: "parent", label: "Parent (via link)" },
    });
    return;
  }
  // A second attempt while one is still processing: an event, not a move.
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event,
    jobs: [verify],
    actor: { type: "parent", label: "Parent (via link)" },
  });
}

/**
 * A payment is confirmed — by the gateway's verify, or by a bank receipt a
 * person recorded. Idempotent on the payment row: a verify that arrives
 * twice settles once.
 */
export async function onPaymentVerified(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  request: PaymentRequestRow,
  payment: PaymentRow,
  result: { approvalCode: string | null },
  actor: Actor
): Promise<void> {
  const { data: settled } = await admin
    .from("payments")
    .update({ status: "succeeded", approval_code: result.approvalCode, failure_reason: null })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");
  if (!settled?.length) return;

  const paidMinor = Number(request.paid_minor) + Number(payment.amount_minor);
  const settledInFull = paidMinor >= Number(request.amount_minor);
  const { error } = await admin
    .from("payment_requests")
    .update({ paid_minor: paidMinor, status: settledInFull ? "paid" : "partially_paid", paid_at: settledInFull ? new Date().toISOString() : null })
    .eq("id", request.id);
  if (error) throw new WorkflowError(error.message, "database");

  const amount = formatMoney(Number(payment.amount_minor), payment.currency);
  const method = payment.method === "eft" ? "bank transfer" : "online";

  if (!settledInFull) {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: {
        type: "payment.partial",
        summary: `Part payment of ${amount} received (${method}); ${formatMoney(Number(request.amount_minor) - paidMinor, request.currency)} outstanding`,
        payload: { payment_id: payment.id, payment_request_id: request.id, paid_minor: paidMinor },
      },
      tasks: [
        {
          type: "payment_shortfall",
          title: `${app.child_first_name}: part payment received, balance outstanding`,
          details: `${amount} received by ${method}; ${formatMoney(Number(request.amount_minor) - paidMinor, request.currency)} still due. Contact the parent about the balance.`,
          priority: "high",
        },
      ],
      audit: { action: "payment.received", entityType: "payment", entityId: payment.id, after: { amount_minor: payment.amount_minor, method: payment.method, partial: true } },
      actor,
    });
    return;
  }

  if (app.status !== "payment_required" && app.status !== "payment_processing") {
    // Money for an application that is not waiting for money: withdrawn,
    // or already paid another way. Never silently absorbed.
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: {
        type: "payment.received_unexpected",
        summary: `Payment of ${amount} received while the application is ${app.status}`,
        payload: { payment_id: payment.id, payment_request_id: request.id },
      },
      tasks: [
        {
          type: "payment_refund_review",
          title: `${app.child_first_name}: payment received, application is ${app.status}`,
          details: `${amount} arrived by ${method} but the application is not awaiting payment. Decide whether to refund or apply it.`,
          priority: "high",
        },
      ],
      audit: { action: "payment.received", entityType: "payment", entityId: payment.id, after: { amount_minor: payment.amount_minor, method: payment.method, unexpected: true } },
      actor,
    });
    return;
  }

  const settings = await getSettings(admin);
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "paid",
    nextAction: "none",
    event: {
      type: "payment.confirmed",
      summary: `Payment of ${amount} confirmed (${method})`,
      payload: { payment_id: payment.id, payment_request_id: request.id, provider: payment.provider, provider_ref: payment.provider_ref, approval_code: result.approvalCode },
    },
    resolveTaskTypes: ["payment_overdue", "payment_failed_follow_up", "payment_review", "payment_shortfall"],
    audit: { action: "payment.confirmed", entityType: "payment", entityId: payment.id, after: { amount_minor: payment.amount_minor, method: payment.method, provider: payment.provider } },
    actor,
  });

  const jobs: JobSpec[] = [
    {
      type: "send_email",
      payload: { template_key: "payment_received", links: ["registration"], payment_id: payment.id, payment_request_id: request.id },
      idempotencyKey: `email:${app.id}:payment_received:${payment.id}`,
    },
  ];
  for (const days of settings.registrationReminderDays) {
    jobs.push({
      type: "send_email",
      payload: { template_key: "registration_reminder", links: ["registration"] },
      idempotencyKey: `email:${app.id}:registration_reminder:${request.id}:${days}d`,
      runAfter: new Date(Date.now() + days * DAY),
      precondition: { application_status: ["registration_incomplete"] },
    });
  }
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: "paid",
    newStatus: "registration_incomplete",
    nextAction: "complete_registration",
    nextActionDueAt: new Date(Date.now() + (settings.registrationReminderDays[0] ?? 7) * DAY),
    event: { type: "registration.opened", summary: "Registration opened for the parent to complete", payload: { payment_request_id: request.id } },
    jobs,
    actor: { type: "system", label: "System" },
  });
}

/** The gateway said no, or never said yes in time. Back to "payment required" with a way to try again. */
export async function onPaymentFailed(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  request: PaymentRequestRow,
  payment: PaymentRow,
  reason: string,
  actor: Actor,
  opts: { review?: boolean } = {}
): Promise<void> {
  const status = reason === "expired" ? "expired" : "failed";
  const { data: changed } = await admin
    .from("payments")
    .update({ status, failure_reason: reason })
    .eq("id", payment.id)
    .in("status", ["pending", "processing"])
    .select("id");
  if (!changed?.length) return;
  await admin.from("payment_requests").update({ status: "failed" }).eq("id", request.id).eq("status", "processing");

  const tasks: TaskSpec[] = [
    {
      type: "payment_failed_follow_up",
      title: `${app.child_first_name}: online payment not completed`,
      details: `Reason: ${reason}. The parent has been emailed a link to try again; call if it happens twice.`,
      priority: "normal",
    },
  ];
  if (opts.review) {
    tasks.push({
      type: "payment_review",
      title: `${app.child_first_name}: payment amount does not match — finance to check`,
      details: `The gateway reports a payment whose amount or currency differs from the request (${reason}). Check with the provider before recording anything.`,
      priority: "high",
    });
  }
  const jobs: JobSpec[] = [
    {
      type: "send_email",
      payload: { template_key: "payment_failed", links: ["payment"], payment_request_id: request.id },
      idempotencyKey: `email:${app.id}:payment_failed:${payment.id}`,
    },
  ];
  const event = {
    type: "payment.failed",
    summary: `Online payment not completed: ${reason}`,
    payload: { payment_id: payment.id, payment_request_id: request.id, reason },
  };
  if (app.status === "payment_processing") {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: "payment_processing",
      newStatus: "payment_required",
      nextAction: "pay_fees",
      nextActionDueAt: due(request),
      event,
      tasks,
      jobs,
      audit: { action: "payment.failed", entityType: "payment", entityId: payment.id, after: { reason } },
      actor,
    });
    return;
  }
  await commit(admin, { applicationId: app.id, expectedStatus: null, newStatus: null, nextAction: null, event, tasks, jobs, actor });
}

/** Finance records a bank transfer. The receipt then settles the request like any other payment. */
export async function onEftRecorded(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name" | "reference">,
  request: PaymentRequestRow,
  receipt: { amountMinor: number; receivedOn: string; bankReference: string; note: string | null },
  actor: Actor
): Promise<PaymentRow> {
  if (!["required", "processing", "failed", "partially_paid"].includes(request.status)) {
    throw new WorkflowError(`The payment request is ${request.status}; nothing is outstanding.`, "status_conflict");
  }
  const { data: payment, error } = await admin
    .from("payments")
    .insert({
      payment_request_id: request.id,
      application_id: app.id,
      method: "eft",
      provider: "bank",
      company_ref: `${app.reference}-EFT-${receipt.bankReference.slice(0, 24)}`,
      status: "pending",
      amount_minor: receipt.amountMinor,
      currency: request.currency,
      bank_reference: receipt.bankReference,
      received_on: receipt.receivedOn,
      recorded_by: actor.type === "staff" ? (actor.id ?? null) : null,
      note: receipt.note,
    })
    .select("*")
    .single();
  if (error || !payment) throw new WorkflowError(error?.message ?? "payment insert failed", "database");

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: {
      type: "payment.eft_recorded",
      summary: `Bank transfer of ${formatMoney(receipt.amountMinor, request.currency)} recorded (ref ${receipt.bankReference})`,
      payload: { payment_id: payment.id, payment_request_id: request.id },
    },
    audit: {
      action: "payment.eft_recorded",
      entityType: "payment",
      entityId: payment.id,
      after: { amount_minor: receipt.amountMinor, bank_reference: receipt.bankReference, received_on: receipt.receivedOn, note: receipt.note } as Json,
    },
    actor,
  });
  await onPaymentVerified(admin, app, request, payment, { approvalCode: null }, actor);
  return payment;
}

/** Finance records that money went back. The application does not move: withdrawing is a separate decision. */
export async function onPaymentRefunded(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "child_first_name">,
  payment: PaymentRow,
  note: string,
  actor: Actor
): Promise<void> {
  if (payment.status !== "succeeded") throw new WorkflowError("Only a successful payment can be refunded.", "status_conflict");
  const now = new Date().toISOString();
  const { error } = await admin
    .from("payments")
    .update({ status: "refunded", refunded_at: now, refunded_by: actor.type === "staff" ? (actor.id ?? null) : null, refund_note: note })
    .eq("id", payment.id)
    .eq("status", "succeeded");
  if (error) throw new WorkflowError(error.message, "database");
  const { data: request } = await admin.from("payment_requests").select("*").eq("id", payment.payment_request_id).single();
  if (request) {
    const paidMinor = Math.max(0, Number(request.paid_minor) - Number(payment.amount_minor));
    await admin
      .from("payment_requests")
      .update({ paid_minor: paidMinor, status: paidMinor > 0 ? "partially_paid" : "refunded", paid_at: null })
      .eq("id", request.id);
  }
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: "payment.refunded", summary: `Refund of ${formatMoney(Number(payment.amount_minor), payment.currency)} recorded: ${note}`, payload: { payment_id: payment.id } },
    audit: { action: "payment.refunded", entityType: "payment", entityId: payment.id, after: { note } },
    actor,
  });
}
