import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, Json, OfferRow, PaymentRequestRow } from "@/lib/supabase/types";
import { formatDate, formatDateLong, toSchoolDateString } from "@/lib/format-date";
import { feeSnapshotFrom, renderOffer } from "@/lib/offers/snapshot";
import { rescheduleForDueDate } from "@/lib/payments/due-date";
import { OPEN_REQUEST_STATUSES } from "@/lib/payments/requests";
import { getSettings } from "@/lib/settings";
import { commit, WorkflowError, type Actor, type JobSpec } from "@/lib/workflow/engine";
import { reminderJobs } from "@/lib/workflow/reminder-jobs";
import { isNextAction } from "@/lib/workflow/states";

/**
 * Moving the date a family must answer by: the offer's closing date, or the
 * payment request's due date once they have accepted.
 *
 * Both dates are read live by what the parent sees — the offer and payment
 * pages, every reminder — so the column is enough for the words. The clock
 * is not: the expiry sweep, the overdue sweep and the reminders each carry
 * the old date in their own `run_after`, and must move with it. A sweep that
 * has already run is replaced by one for the new date, so a family whose
 * deadline passed and was then extended is still followed up when the new
 * one passes.
 *
 * Written for 22 October 2026, when the school moved every scholarship
 * family's deadline to 5 December 2026, including those whose offers had
 * already lapsed, and asked for each family to be told.
 *
 * `notify` queues the `deadline_moved` email with the new date. Nothing is
 * sent from here directly; the drain sends it, under the same preconditions
 * as every other email about an offer or a payment.
 *
 * The rows written before the commit are put back if the commit refuses
 * (a stale screen, a stage moved in the same second), so a move either
 * happens whole or not at all: an offer reopened under an application still
 * marked expired could not be moved again or answered.
 */

const MINUTE = 60_000;

/**
 * One suffix per move, not per date. Every move stands the previous sweep and
 * reminders down, and their keys stay taken: keyed by the date alone, moving
 * 5 December → 10 December → 5 December found `offer_expire:<id>:2026-12-05`
 * already used and queued no sweep, no reminders and no email, so the
 * reopened offer never lapsed. A repeat of the same move still adds nothing:
 * both functions return before queueing when the date is already the one asked.
 */
function moveKey(at: Date): string {
  return `${toSchoolDateString(at)}:${Date.now()}`;
}

/**
 * The offer's closing date, and reopening one that lapsed.
 *
 * An expired offer goes back to the family as it was — the same letter, the
 * same fees, the same acceptance page — rather than being re-issued: a new
 * letter would be priced from today's schedule, re-sent as if new, and lose
 * the record of the one they were given. The letter's own "open until" line
 * is the one thing re-rendered, from the variables it froze, so the letter
 * and the page agree on the date.
 */
export async function onOfferDeadlineMoved(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  offer: Pick<OfferRow, "id" | "status" | "expires_at" | "template_id" | "variables" | "first_viewed_at" | "fees" | "rendered_html" | "terms_html">,
  newExpiresAt: Date,
  reason: string,
  actor: Actor,
  opts: { notify?: boolean } = {}
): Promise<{ reopened: boolean }> {
  const open = (offer.status === "sent" || offer.status === "viewed") && app.status === "offer_sent";
  const lapsed = offer.status === "expired" && app.status === "offer_expired";
  if (!open && !lapsed) throw new WorkflowError(`The offer is ${offer.status} and the application ${app.status}, so its closing date cannot move.`, "status_conflict");
  if (newExpiresAt.getTime() <= Date.now()) throw new WorkflowError("The new closing date must be in the future.", "status_conflict");
  if (offer.expires_at && new Date(offer.expires_at).getTime() === newExpiresAt.getTime() && open) return { reopened: false };

  const { data: template, error: templateErr } = await admin.from("offer_templates").select("*").eq("id", offer.template_id).single();
  if (templateErr || !template) throw new WorkflowError(templateErr?.message ?? "offer template missing", "database");
  const frozen = (offer.variables as Record<string, string | null>) ?? {};
  // A letter frozen before `registration_fee_label` existed (22 October 2026)
  // has no such variable, but its template row was given `{{registration_fee_label}}`
  // in place (20261022180159_the_letter_names_the_application_fee.sql), so a
  // re-render printed the fee with no name. The fee snapshot it froze names
  // the line as it was priced, which is what the letter would have said.
  const feeLabel =
    "registration_fee_label" in frozen
      ? frozen.registration_fee_label
      : (feeSnapshotFrom(offer.fees)?.lines.find((l) => l.code === "registration")?.label ?? null);
  const vars = { ...frozen, registration_fee_label: feeLabel, offer_expiry_date: formatDateLong(newExpiresAt) };
  const rendered = renderOffer(template, vars);

  // Back to where it was before it lapsed: viewed if the family had opened it.
  const status = lapsed ? (offer.first_viewed_at ? "viewed" : "sent") : offer.status;
  const { data: moved, error } = await admin
    .from("offers")
    .update({ expires_at: newExpiresAt.toISOString(), variables: vars as unknown as Json, rendered_html: rendered.html, terms_html: rendered.terms, status })
    .eq("id", offer.id)
    .eq("status", offer.status)
    .select("id");
  if (error) throw new WorkflowError(error.message, "database");
  if (!moved?.length) throw new WorkflowError("The offer changed while this was being saved. Reload and try again.", "status_conflict");

  const settings = await getSettings(admin);
  const live = { offer_id: offer.id, offer_status: ["sent", "viewed"] };
  const key = moveKey(newExpiresAt);
  const jobs: JobSpec[] = [
    {
      type: "offer_expire",
      payload: { offer_id: offer.id },
      idempotencyKey: `offer_expire:${offer.id}:${key}`,
      runAfter: new Date(newExpiresAt.getTime() + MINUTE),
      precondition: live,
    },
    ...reminderJobs({
      applicationId: app.id,
      template: "offer_reminder",
      subjectId: offer.id,
      deadline: newExpiresAt,
      daysBefore: settings.offerReminderDaysBefore,
      payload: { links: ["offer"], offer_id: offer.id },
      precondition: live,
      suffix: key,
    }),
  ];
  if (opts.notify) {
    jobs.push({
      type: "send_email",
      payload: { template_key: "deadline_moved", links: ["offer"], offer_id: offer.id, variables: { new_deadline: formatDateLong(newExpiresAt), offer_open: "yes", fees_due: null } },
      idempotencyKey: `email:${app.id}:deadline_moved:${offer.id}:${key}`,
      precondition: live,
    });
  }

  const was = offer.expires_at ? formatDate(offer.expires_at) : "no date";
  try {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      // The current status for an open offer, not null: null is a pure event
      // and would leave the application's own due date — what the task list
      // and the overdue counts read — on the old closing date.
      newStatus: "offer_sent",
      nextAction: "review_offer",
      nextActionDueAt: newExpiresAt,
      event: {
        type: "offer.deadline_moved",
        summary: `${lapsed ? "Expired offer reopened" : "Offer closing date moved"}: ${was} → ${formatDate(newExpiresAt)}`,
        payload: { offer_id: offer.id, from: offer.expires_at, to: newExpiresAt.toISOString(), reopened: lapsed, reason, emailed: Boolean(opts.notify) },
      },
      resolveTaskTypes: lapsed ? ["follow_up_expired_offer"] : [],
      jobs,
      audit: { action: "offer.deadline_moved", entityType: "offer", entityId: offer.id, before: { expires_at: offer.expires_at, status: offer.status }, after: { expires_at: newExpiresAt.toISOString(), status } },
      actor,
    });
  } catch (e) {
    // The application did not move, so neither does the offer.
    await admin
      .from("offers")
      .update({ expires_at: offer.expires_at, variables: offer.variables, rendered_html: offer.rendered_html, terms_html: offer.terms_html, status: offer.status })
      .eq("id", offer.id)
      .eq("status", status);
    throw e;
  }

  // Only now do the old sweep and reminders stand down: had the move been
  // refused, they would still be the offer's. This move's own jobs share the
  // pattern and are kept by their suffix.
  await skipPending(admin, app.id, [`offer_expire:${offer.id}%`, `email:${app.id}:offer_reminder:${offer.id}:%`], key, "the offer's closing date moved");
  return { reopened: lapsed };
}

/**
 * The payment request's due date, after the family has accepted.
 *
 * `payment_due_days` decides what every new request gets, once, when the
 * offer is accepted; this is how one family's date moves afterwards. Moving
 * it into the past is how a family is marked late on purpose, and the
 * overdue sweep then runs at once.
 */
export async function onPaymentDeadlineMoved(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "next_action" | "next_action_due_at">,
  request: Pick<PaymentRequestRow, "id" | "due_at">,
  newDueAt: Date,
  reason: string,
  actor: Actor,
  opts: { notify?: boolean } = {}
): Promise<{ moved: boolean }> {
  const was = request.due_at;
  if (new Date(was).getTime() === newDueAt.getTime()) return { moved: false };

  // The overdue sweep and the reminders, which carry the old date in their
  // own `run_after`. Pending only — one that has already gone out is history.
  // Read first, so a refused move can put them back exactly as they were.
  const { data: pending, error: pendingErr } = await admin
    .from("jobs")
    .select("id, type, idempotency_key, run_after")
    .eq("application_id", app.id)
    .eq("status", "pending")
    .or(`type.eq.payment_overdue,idempotency_key.like.%:payment_reminder:${request.id}:%`);
  if (pendingErr) throw new WorkflowError(pendingErr.message, "database");
  const ours = (pending ?? []).filter((j) => j.type !== "payment_overdue" || j.idempotency_key.startsWith(`payment_overdue:${request.id}`));
  const moves = rescheduleForDueDate(ours, newDueAt);

  const { data: moved, error: dueErr } = await admin
    .from("payment_requests")
    .update({ due_at: newDueAt.toISOString() })
    .eq("id", request.id)
    .in("status", [...OPEN_REQUEST_STATUSES])
    .select("id");
  if (dueErr) throw new WorkflowError(dueErr.message, "database");
  if (!moved?.length) throw new WorkflowError("This payment request is no longer open.", "status_conflict");

  // Everything written from here is undone if the commit refuses the move.
  const undo = async () => {
    await admin.from("payment_requests").update({ due_at: was }).eq("id", request.id);
    if (app.next_action === "pay_fees") await admin.from("applications").update({ next_action_due_at: app.next_action_due_at }).eq("id", app.id);
    for (const job of ours) {
      await admin.from("jobs").update({ status: "pending", run_after: job.run_after, last_error: null, completed_at: null }).eq("id", job.id);
    }
  };

  // A deadline that had already passed has no sweep left to move: the one it
  // had ran, and opened the "fees overdue" task. Moved into the future, that
  // task is answered, and the new date needs its own sweep and reminders.
  const future = newDueAt.getTime() > Date.now();
  const sweepPending = ours.some((j) => j.type === "payment_overdue");
  const key = moveKey(newDueAt);
  const precondition = { application_status: ["payment_required" as const] };
  const jobs: JobSpec[] = [];
  if (future && !sweepPending) {
    const settings = await getSettings(admin);
    jobs.push(
      {
        type: "payment_overdue",
        payload: { payment_request_id: request.id },
        idempotencyKey: `payment_overdue:${request.id}:${key}`,
        runAfter: new Date(newDueAt.getTime() + MINUTE),
        precondition,
      },
      ...reminderJobs({
        applicationId: app.id,
        template: "payment_reminder",
        subjectId: request.id,
        deadline: newDueAt,
        daysBefore: settings.paymentReminderDaysBefore,
        payload: { links: ["payment"], payment_request_id: request.id },
        precondition,
        suffix: key,
      })
    );
  }
  if (opts.notify && future) {
    jobs.push({
      type: "send_email",
      payload: { template_key: "deadline_moved", links: ["payment"], payment_request_id: request.id, variables: { new_deadline: formatDateLong(newDueAt), offer_open: null, fees_due: "yes" } },
      idempotencyKey: `email:${app.id}:deadline_moved:${request.id}:${key}`,
      precondition,
    });
  }

  try {
    // The applicant's own "due" field, which drives the staff task list and
    // the overdue counts on the dashboard. Only while the application is still
    // waiting on this payment: a later stage's due date is not ours to move.
    if (app.next_action === "pay_fees") {
      const { error } = await admin.from("applications").update({ next_action_due_at: newDueAt.toISOString() }).eq("id", app.id);
      if (error) throw new WorkflowError(error.message, "database");
    }
    for (const move of moves) {
      const patch =
        move.action === "reschedule"
          ? { run_after: move.runAfter }
          : { status: "skipped" as const, last_error: move.reason, completed_at: new Date().toISOString() };
      const { error } = await admin.from("jobs").update(patch).eq("id", move.id).eq("status", "pending");
      if (error) throw new WorkflowError(error.message, "database");
    }

    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: null,
      nextAction: isNextAction(app.next_action) ? app.next_action : null,
      nextActionDueAt: app.next_action === "pay_fees" ? newDueAt : undefined,
      event: {
        type: "payment.due_date_changed",
        summary: `Payment deadline ${formatDate(was)} → ${formatDate(newDueAt)}`,
        payload: {
          payment_request_id: request.id,
          from: was,
          to: newDueAt.toISOString(),
          reason,
          rescheduled: moves.filter((m) => m.action === "reschedule").length,
          skipped: moves.filter((m) => m.action === "skip").length,
          emailed: Boolean(opts.notify && future),
        },
      },
      resolveTaskTypes: future ? ["payment_overdue"] : [],
      jobs,
      audit: { action: "payment.due_date_changed", entityType: "payment_request", entityId: request.id, before: { due_at: was }, after: { due_at: newDueAt.toISOString() } },
      actor,
    });
  } catch (e) {
    await undo();
    throw e;
  }
  return { moved: true };
}

/**
 * Pending jobs for one applicant whose key matches one of the patterns, stood
 * down with a reason. Keys ending in `keep` are this move's own and stay.
 */
async function skipPending(admin: AdminClient, applicationId: string, keyPatterns: string[], keep: string, reason: string): Promise<void> {
  const { data, error } = await admin
    .from("jobs")
    .select("id, idempotency_key")
    .eq("application_id", applicationId)
    .eq("status", "pending")
    .or(keyPatterns.map((p) => `idempotency_key.like.${p}`).join(","));
  if (error) throw new WorkflowError(error.message, "database");
  for (const job of data ?? []) {
    if (job.idempotency_key.endsWith(`:${keep}`)) continue;
    const { error: skipErr } = await admin
      .from("jobs")
      .update({ status: "skipped", last_error: reason, completed_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending");
    if (skipErr) throw new WorkflowError(skipErr.message, "database");
  }
}
