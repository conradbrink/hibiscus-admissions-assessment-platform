import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, ApplicationStatus, OfferRow } from "@/lib/supabase/types";
import { loadApplicationGraph } from "@/lib/applications";
import { resolveFeeSchedule } from "@/lib/offers/render";
import { getSettings } from "@/lib/settings";
import { mustSucceed, onDeferred } from "@/lib/workflow/actions";
import { onStaffDecision } from "@/lib/workflow/decision-actions";
import { commit, WorkflowError, type Actor, type JobSpec, type TaskSpec } from "@/lib/workflow/engine";
import { JOURNEY } from "@/lib/workflow/next-step";
import { hasResults, onOfferAccepted, onOfferApproved, onOfferDrafted, onOfferWithdrawn } from "@/lib/workflow/offer-actions";
import { BACK_MOOT_TASKS, defersThroughDecision, moveDirection, moveTargetLabel, mootTaskTypes, movePosition, type MoveTarget } from "@/lib/workflow/stage-move";
import { formatMoney } from "@/lib/money";
import { askable, CHECKOUT_TTL_HOURS, recentAttemptsSince } from "@/lib/payments/attempts";
import { formatDateTime } from "@/lib/format-date";
import { STATUS_LABELS } from "@/lib/workflow/states";

/**
 * Move to stage, the doing half. The rules — which stages lie ahead, which
 * tasks a move makes moot — are pure, in `stage-move.ts`.
 *
 * Two of the four moves are edges of their own (`OVERRIDE_TRANSITIONS`):
 * into a decision without an assessment, and straight into registration.
 * The other two press the existing buttons in order, on the family's behalf
 * — record the approval, draft the letter, approve it, record the
 * acceptance — so the decision row, the offer, the acceptance and the payment
 * request all exist exactly as if each had been pressed, and every screen
 * after them works unchanged. Each press is its own atomic commit; if one is
 * refused part way, the child rests at the last legal status reached, every
 * step so far is on the timeline, and the officer is told which step stopped.
 *
 * What the parent hears is the point of the exercise: only what is due from
 * them now. The steps skipped send nothing; the stage landed on sends its
 * own message (the payment request at Payment, `registration_open` at
 * Registration) or, at Decision and Offer, nothing until a person sends it.
 */

type MovingApp = Pick<ApplicationRow, "id" | "status" | "reference" | "child_first_name" | "requires_assessment">;

export type StageMove = {
  target: MoveTarget;
  reason: string;
  /**
   * The family says the fees are paid already. Only read by the move to
   * Registration: their payment request stays open, so finance can record
   * the money against it, and a task asks finance to confirm it.
   */
  alreadyPaid: boolean;
};

const DAY = 86_400_000;
const at = (stage: (typeof JOURNEY)[number]["key"]) => JOURNEY.findIndex((s) => s.key === stage);

async function reload(admin: AdminClient, applicationId: string): Promise<MovingApp> {
  const { data, error } = await admin
    .from("applications")
    .select("id, status, reference, child_first_name, requires_assessment")
    .eq("id", applicationId)
    .single();
  if (error || !data) throw new WorkflowError(error?.message ?? "application missing", "database");
  return data;
}

/** The newest offer in one of these statuses, or null. */
async function offerIn(admin: AdminClient, applicationId: string, statuses: OfferRow["status"][]): Promise<OfferRow | null> {
  const { data, error } = await admin
    .from("offers")
    .select("*")
    .eq("application_id", applicationId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return data;
}

/**
 * The bookings and the sitting a skipped assessment leaves behind.
 *
 * A booked assessment is cancelled whatever the status, so its reminders stop
 * and the seat goes back. A booked visit only while the visit is the stage
 * being skipped: a family with a decision already in hand may still come and
 * look round, and their visit is not ours to take away. A visit that
 * happened stays checked in — it is what happened. Nothing is emailed: the
 * officer has just spoken to the family, and the move is the message.
 */
async function releaseAssessment(admin: AdminClient, app: MovingApp, why: string): Promise<void> {
  const now = new Date().toISOString();
  const cancelled = { status: "cancelled" as const, cancelled_at: now, cancel_reason: why };
  await mustSucceed(
    app.reference,
    "moved on",
    "cancel its assessment booking",
    admin.from("bookings").update(cancelled).eq("application_id", app.id).eq("kind", "assessment").eq("status", "booked")
  );
  if (app.status === "visit_booked") {
    await mustSucceed(
      app.reference,
      "moved on",
      "cancel its visit",
      admin.from("bookings").update(cancelled).eq("application_id", app.id).eq("kind", "visit").eq("status", "booked")
    );
  }
  if (app.status === "assessment_booked") {
    // Arrived for the sitting but not started: the sitting will not happen.
    await mustSucceed(
      app.reference,
      "moved on",
      "release its check-in",
      admin.from("bookings").update(cancelled).eq("application_id", app.id).eq("kind", "assessment").eq("status", "checked_in")
    );
  }
  await mustSucceed(
    app.reference,
    "moved on",
    "abandon its unstarted sitting",
    admin.from("attempts").update({ status: "abandoned" }).eq("application_id", app.id).eq("status", "ready")
  );
}

/** To a decision without an assessment. `final` when Decision is where the officer asked to go. */
async function toDecision(admin: AdminClient, app: MovingApp, reason: string, actor: Actor, final: boolean): Promise<MovingApp> {
  await releaseAssessment(admin, app, "Assessment skipped by staff");
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "awaiting_decision",
    nextAction: "await_decision",
    event: final
      ? { type: "application.moved_to_stage", summary: `Moved to Decision by staff, without an assessment: ${reason}`, payload: { from: app.status, to: "decision", reason } }
      : { type: "assessment.skipped", summary: `Assessment skipped by staff: ${reason}`, payload: { from: app.status, reason } },
    resolveTaskTypes: mootTaskTypes("decision"),
    audit: {
      action: final ? "application.moved_to_stage" : "assessment.skipped",
      before: { status: app.status },
      after: { stage: "decision", reason },
    },
    actor,
    override: true,
  });
  return reload(admin, app.id);
}

/** Accepted, and the letter drafted. It waits for approval unless `autoApprove` lets the school's switch send it. */
async function toOffer(admin: AdminClient, app: MovingApp, reason: string, actor: Actor, opts: { autoApprove: boolean }): Promise<MovingApp> {
  let cur = app;
  if ((movePosition(cur.status) ?? 0) < at("decision")) cur = await toDecision(admin, cur, reason, actor, false);
  // The same decision a person records from the review queue: a decision row
  // with the reason, and the offer drafted from it.
  await onStaffDecision(admin, cur, "approved", `Moved on by staff: ${reason}`, actor);
  cur = await reload(admin, cur.id);
  // Drafted now rather than by the queued job, so the move to Payment can go
  // on from it. The job finds the child no longer `approved` and skips.
  await onOfferDrafted(admin, cur, actor, { autoApprove: opts.autoApprove });
  return reload(admin, cur.id);
}

/**
 * What would stop the move to Payment part way, asked before anything is
 * written: a letter cannot be priced with no fee schedule, nor approved for a
 * child who sat while their learning profile is still being written.
 */
async function preflightPayment(admin: AdminClient, app: MovingApp): Promise<void> {
  if (app.status === "offer_sent") return;
  if (app.status !== "offer_pending_approval") {
    const graph = await loadApplicationGraph(admin, app.id);
    if (!graph) throw new WorkflowError("application missing", "database");
    const schedule = await resolveFeeSchedule(admin, {
      campusId: graph.application.campus_id,
      academicYearId: graph.intake.academic_year_id,
      gradeSort: graph.grade.sort_order,
    });
    if (!schedule || schedule.lines.length === 0) {
      throw new WorkflowError(
        `No active fee schedule covers ${graph.campus.name}, ${graph.grade.name}, so there is nothing to ask the family to pay. Set the fees under Fees, or move the child to Registration instead.`,
        "status_conflict"
      );
    }
  }
  if (app.requires_assessment && (await hasResults(admin, app.id))) {
    const { count, error } = await admin
      .from("learning_profiles")
      .select("id", { count: "exact", head: true })
      .eq("application_id", app.id)
      .not("published_at", "is", null);
    if (error) throw new WorkflowError(error.message, "database");
    if (!count) throw new WorkflowError("The learning profile is still being written, and the offer cannot be approved without it. Try again in a minute.", "status_conflict");
  }
}

/** Accepted, the letter approved without emailing it, and the family's acceptance recorded: the payment request goes out. */
async function toPayment(admin: AdminClient, app: MovingApp, reason: string, actor: Actor): Promise<MovingApp> {
  await preflightPayment(admin, app);
  let cur = app;
  if ((movePosition(cur.status) ?? 0) < at("offer")) cur = await toOffer(admin, cur, reason, actor, { autoApprove: false });

  // A letter nobody can accept any more is replaced by a fresh one.
  if (cur.status === "offer_expired") {
    const expired = await offerIn(admin, cur.id, ["sent", "viewed", "expired"]);
    if (!expired) throw new WorkflowError("The expired offer could not be found.", "database");
    await onOfferWithdrawn(admin, cur, expired, `Re-issued to move on to payment: ${reason}`, actor);
    cur = await reload(admin, cur.id);
  }
  if (cur.status === "offer_declined") {
    await commit(admin, {
      applicationId: cur.id,
      expectedStatus: "offer_declined",
      newStatus: "offer_draft",
      nextAction: "await_offer",
      event: { type: "offer.reopened", summary: `The declined offer is replaced by a new one: ${reason}`, payload: { reason } },
      resolveTaskTypes: ["follow_up_declined_offer"],
      actor,
    });
    cur = await reload(admin, cur.id);
  }
  if (cur.status === "approved" || cur.status === "offer_draft") {
    const drafted = await onOfferDrafted(admin, cur, actor, { autoApprove: false });
    if (drafted.blocked) {
      throw new WorkflowError("The offer could not be priced: no active fee schedule covers this campus, stage and year. The child is at Offer, waiting on fees.", "status_conflict");
    }
    cur = await reload(admin, cur.id);
  }
  if (cur.status === "offer_pending_approval") {
    const pending = await offerIn(admin, cur.id, ["pending_approval"]);
    if (!pending) throw new WorkflowError("The offer waiting for approval could not be found.", "database");
    await onOfferApproved(admin, cur, pending, actor, { notify: false });
    cur = await reload(admin, cur.id);
  }
  if (cur.status === "offer_sent") {
    const sent = await offerIn(admin, cur.id, ["sent", "viewed"]);
    if (!sent) throw new WorkflowError("The offer to accept could not be found.", "database");
    // The acceptance record says who recorded it: the actor is the officer,
    // on the timeline and in the audit, and the device line says so too.
    try {
      await onOfferAccepted(admin, cur, sent, { termsAccepted: true, ipHash: null, userAgent: "Recorded by staff on the family's behalf (Move to stage)" }, actor);
    } catch (e) {
      // The letter was approved above without an email, a reminder or an
      // expiry, because the acceptance was to follow at once. Left out, it
      // would sit at "offer sent" for ever with the family holding nothing.
      // Withdrawn, the child rests at Offer with a letter to draft again —
      // but only if it is still the one we approved, still unanswered.
      const still = await reload(admin, cur.id);
      const unanswered = await offerIn(admin, cur.id, ["sent", "viewed"]);
      if (still.status === "offer_sent" && unanswered?.id === sent.id) {
        await onOfferWithdrawn(admin, still, sent, `Move to Payment stopped before the acceptance was recorded: ${(e as Error).message}`, actor);
      }
      throw e;
    }
    cur = await reload(admin, cur.id);
  }
  return cur;
}

/**
 * Withdraws every letter in these statuses, with one `offer.withdrawn` line
 * each, as `onOfferWithdrawn` writes: it is what the journey bar reads to
 * stop ticking Offer for a letter that is no longer out, and what tells the
 * next person why the family's link stopped working. Shared by the move to
 * Registration and the moves back, so the two cannot drift. Returns how many.
 */
async function withdrawLetters(
  admin: AdminClient,
  app: MovingApp,
  statuses: OfferRow["status"][],
  why: string,
  reason: string,
  actor: Actor,
  failure: string
): Promise<number> {
  const { data: withdrawn, error } = await admin
    .from("offers")
    .update({ status: "withdrawn", withdrawn_reason: why.slice(0, 300) })
    .eq("application_id", app.id)
    .in("status", statuses)
    .select("id");
  if (error) throw new WorkflowError(`${app.reference}: ${failure} (${error.message}).`, "database");
  for (const offer of withdrawn ?? []) {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "offer.withdrawn", summary: `Offer withdrawn: ${why}`, payload: { offer_id: offer.id, reason } },
      audit: { action: "offer.withdrawn", entityType: "offer", entityId: offer.id, after: { reason: why } },
      actor,
    });
  }
  return (withdrawn ?? []).length;
}

/**
 * Straight into registration, from wherever the child is.
 *
 * No decision row, no offer and no acceptance are invented on the way: none
 * was made through the system, and the registration, the agreements the
 * parent signs there and the enrolment need none of them. A letter in play is
 * withdrawn, so its reminders and its expiry stop.
 *
 * The money is the part to get right, because "paid" here means verified (a
 * gateway confirmation or a receipt finance recorded) and an officer at the
 * desk has neither. So nothing is marked paid. When the family says they have
 * paid, their payment request stays open for finance to record the money
 * against, and a task asks finance to confirm it; `onPaymentVerified` then
 * files the receipt as the confirmation rather than as money to refund.
 * Otherwise an open request is closed, so finance is not left chasing it.
 */
async function toRegistration(admin: AdminClient, app: MovingApp, move: StageMove, reason: string, actor: Actor): Promise<MovingApp> {
  const { data: openRequests, error: reqErr } = await admin
    .from("payment_requests")
    .select("id")
    .eq("application_id", app.id)
    .in("status", ["required", "failed", "partially_paid"]);
  if (reqErr) throw new WorkflowError(reqErr.message, "database");
  const hasOpenRequest = (openRequests ?? []).length > 0;

  await releaseAssessment(admin, app, "Moved straight to registration by staff");
  await withdrawLetters(
    admin,
    app,
    ["draft", "pending_approval", "sent", "viewed", "expired"],
    "moved straight to registration by staff",
    reason,
    actor,
    "was not moved on: we could not withdraw its offer. Its status is unchanged — please try again"
  );
  if (!move.alreadyPaid) {
    // A part payment is money that has moved, and stays open for finance.
    await mustSucceed(
      app.reference,
      "moved on",
      "close its payment request",
      admin.from("payment_requests").update({ status: "cancelled" }).eq("application_id", app.id).in("status", ["required", "failed"])
    );
  }
  await mustSucceed(
    app.reference,
    "moved on",
    "expire its unstarted checkout",
    admin.from("payments").update({ status: "expired", failure_reason: "Moved straight to registration by staff" }).eq("application_id", app.id).eq("status", "pending")
  );
  await mustSucceed(
    app.reference,
    "moved on",
    "open its registration",
    admin.from("registrations").upsert({ application_id: app.id }, { onConflict: "application_id", ignoreDuplicates: true })
  );

  const settings = await getSettings(admin);
  // Per move rather than per child: a child moved back and then on to
  // registration again must hear about it again, and a fixed key would be
  // dropped as already sent.
  const moveStamp = Date.now();
  const jobs: JobSpec[] = [
    {
      type: "send_email",
      payload: { template_key: "registration_open", links: ["registration"] },
      idempotencyKey: `email:${app.id}:registration_open:${moveStamp}`,
      precondition: { application_status: ["registration_incomplete"] },
    },
    // `registration_open` again, not `registration_reminder`: that one says
    // the place is secured, which the offer's terms tie to paying, and a
    // family moved on by hand may not have.
    ...settings.registrationReminderDays.map((days) => ({
      type: "send_email",
      payload: { template_key: "registration_open", links: ["registration"] },
      idempotencyKey: `email:${app.id}:registration_open:${moveStamp}:reminder:${days}d`,
      runAfter: new Date(Date.now() + days * DAY),
      precondition: { application_status: ["registration_incomplete" as const] },
    })),
  ];
  const tasks: TaskSpec[] = move.alreadyPaid
    ? [
        {
          type: "confirm_reported_payment",
          title: `${app.child_first_name}: the family says the fees are paid — please confirm`,
          details: hasOpenRequest
            ? `Moved straight to registration by staff. Reason: ${reason}\n\nFind the payment and record it against the open payment request under Payments. Recording it closes this task.`
            : `Moved straight to registration by staff before an offer was accepted, so there is no payment request to record it against. Reason: ${reason}\n\nFind the payment on the bank statement or in the online payments, and note here what you found before marking this done.`,
          priority: "high",
        },
      ]
    : [];

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "registration_incomplete",
    nextAction: "complete_registration",
    nextActionDueAt: new Date(Date.now() + (settings.registrationReminderDays[0] ?? 7) * DAY),
    event: {
      type: "application.moved_to_stage",
      summary: `Moved to Registration by staff: ${reason}${move.alreadyPaid ? ". The family says the fees are paid; finance is asked to confirm it." : ""}`,
      payload: { from: app.status, to: "registration", reason, already_paid: move.alreadyPaid },
    },
    resolveTaskTypes: mootTaskTypes("registration"),
    tasks,
    jobs,
    audit: {
      action: "application.moved_to_stage",
      before: { status: app.status },
      after: { stage: "registration", reason, already_paid: move.alreadyPaid },
    },
    actor,
    override: true,
  });
  return reload(admin, app.id);
}

/**
 * Why a move back would be refused for money, or null when nothing stops it.
 *
 * The money belongs to the payment request of the letter being withdrawn.
 * Going back would leave it attached to an offer nobody holds, and the next
 * acceptance would ask the family to pay again. A refund is finance's to
 * record, and then the move can be made. A zero-amount settlement (nothing
 * was owed, or a deal waived it) is not money, and does not stop the move.
 * Nor does a refunded payment, which is no longer held.
 *
 * Exported for the applicant page, which hides the way back on the same
 * answer: two copies of this rule had already drifted apart once.
 */
export type MoneyHeld = {
  reason: string;
  /**
   * Worth saying on the applicant page. Every reason is, except money
   * received: that is how almost every child past Payment got there, and
   * the page does not offer a refund as a next step to their family.
   */
  note: boolean;
};

export async function moneyHeldReason(admin: AdminClient, app: Pick<MovingApp, "id" | "child_first_name">): Promise<MoneyHeld | null> {
  const [payments, requests, reported] = await Promise.all([
    admin
      .from("payments")
      .select("status, amount_minor, currency, method, provider_ref, created_at, failure_reason")
      .eq("application_id", app.id)
      .in("status", ["succeeded", "processing", "expired", "failed"]),
    // A request mid-payment or part-paid is money in motion even where no
    // payment row says so (after a refund, or a hand correction); only the
    // unpaid ones are cancelled on the way back, and this one would block the
    // next.
    admin.from("payment_requests").select("id", { count: "exact", head: true }).eq("application_id", app.id).in("status", ["processing", "partially_paid"]),
    // Finance's open money tasks. A reported payment: the family said they
    // had paid, and its request is the one the money is to be recorded
    // against. A payment review: the gateway took a wrong amount, which
    // leaves the row failed, so no payment row counts it as received. (A
    // shortfall or a refund review comes with a succeeded payment, which
    // `held` catches, and stays open after a refund, so it is not asked.)
    admin.from("tasks").select("type").eq("application_id", app.id).eq("status", "open").in("type", ["confirm_reported_payment", "payment_review"]),
  ]);
  const error = payments.error ?? requests.error ?? reported.error;
  if (error) throw new WorkflowError(error.message, "database");
  const rows = payments.data ?? [];
  const name = app.child_first_name;

  const held = rows.filter((p) => p.status === "succeeded" && Number(p.amount_minor) > 0);
  if (held.length) {
    const total = held.reduce((sum, p) => sum + Number(p.amount_minor), 0);
    return { note: false, reason: `${formatMoney(total, held[0].currency)} has been received for ${name}, so their letter cannot be withdrawn. Finance would have to refund it under Payments first.` };
  }
  const tasks = (reported.data ?? []).map((t) => t.type);
  if (tasks.includes("payment_review")) {
    return {
      note: true,
      reason: `A payment for ${name} came in for the wrong amount, and finance has a task to review it. Once finance has dealt with it and marked the task done, you can move them back.`,
    };
  }
  // An attempt still being confirmed, or one that timed out or failed, can
  // still settle at the gateway for its checkout window (the parent finishing
  // on their bank's page, then the revive sweep or their "Check again"), and
  // would land on a request this move had cancelled. A "not paid" from the
  // gateway inside that window is not final either, so nothing but the
  // window closing lifts this, and the note says only that.
  const since = new Date(recentAttemptsSince()).getTime();
  // A wrong amount is money that did go through, which the review above
  // already answers for; it is not an attempt still in the air.
  const live = rows.filter(
    (p) =>
      p.status === "processing" ||
      ((p.status === "expired" || p.status === "failed") && askable(p) && new Date(p.created_at).getTime() >= since && !p.failure_reason?.startsWith("amount_mismatch"))
  );
  if (live.length) {
    const clears = new Date(Math.max(...live.map((p) => new Date(p.created_at).getTime())) + CHECKOUT_TTL_HOURS * 3_600_000);
    if (clears.getTime() > Date.now()) {
      return { note: true, reason: `An online payment ${name}'s family started could still go through at the gateway until ${formatDateTime(clears)}. If it has not gone through by then, you can move them back.` };
    }
    // Only a row still "processing" gets here: past its window, so the
    // sweep has failed to settle it. Waiting will not help; a check will.
    return { note: true, reason: `An online payment ${name}'s family started is still waiting for the gateway's answer. Ask finance to check it with the gateway under Payments; once it is settled, you can move them back.` };
  }
  if (requests.count) {
    return { note: true, reason: `A payment for ${name} is part-paid or still being confirmed. Finance would have to settle or refund it under Payments before they can be moved back.` };
  }
  if (tasks.includes("confirm_reported_payment")) {
    return { note: true, reason: `The family said they had already paid, and finance has not confirmed it yet. Ask finance to record the payment (or close their task) before moving ${name} back.` };
  }
  return null;
}

async function assertNoMoneyHeld(admin: AdminClient, app: MovingApp): Promise<void> {
  const held = await moneyHeldReason(admin, app);
  if (held) throw new WorkflowError(held.reason, "status_conflict");
}

/**
 * The jobs a move back leaves behind, which it skips. Each was queued for a
 * stage the child is no longer at, and most check only the status before
 * they run: the old payment reminders would quote the cancelled request to
 * a family who has since accepted a new letter, and the old registration
 * reminders would arrive alongside the new ones. The money's own checks, the
 * marking and the document readings stay queued.
 */
const STALE_AFTER_MOVE_BACK = ["send_email", "send_whatsapp", "send_outcome", "draft_offer", "offer_expire", "payment_overdue", "auto_enrol"];

/**
 * Back to Decision, or back to Offer.
 *
 * Every letter in play or accepted is withdrawn, each with its own
 * `offer.withdrawn` line (which is also what tells the journey bar the offer
 * is no longer out). The family's signed acceptance stays on file: it is what
 * happened. Unpaid payment requests are cancelled, so the one-open-request
 * rule does not refuse the next acceptance, and an unstarted checkout
 * expires. Nothing is emailed: the family hears from the school again when
 * there is a new decision or a new letter, by the ordinary buttons.
 *
 * Back to Offer then drafts the new letter at once, with the conditions the
 * old one carried, and leaves it for a person to approve — whatever the
 * auto-approve switch says, as every Move to stage letter does.
 */
async function moveBack(
  admin: AdminClient,
  app: MovingApp,
  target: MoveTarget,
  reason: string,
  actor: Actor,
  /** Off for a deferral: the family has paused, and its own call on the date is the work. */
  opts: { decideAgainTask?: boolean } = {}
): Promise<MovingApp> {
  if (target !== "decision" && target !== "offer") {
    throw new WorkflowError(`A child cannot be moved back to ${moveTargetLabel(target)}.`, "illegal_transition");
  }
  await assertNoMoneyHeld(admin, app);

  // The conditions on the letter being replaced, so the new one says them too.
  const previous = await offerIn(admin, app.id, ["draft", "pending_approval", "sent", "viewed", "expired", "accepted"]);
  const why = target === "offer" ? `moved back to Offer by staff, to be redrafted: ${reason}` : `moved back to Decision by staff: ${reason}`;

  // The move first, the tidying after. The status check in this commit is
  // what stops a parent who accepts or pays in the same second: once it is
  // in, their acceptance and their checkout are both refused by status. Done
  // the other way round, their acceptance could be withdrawn and their new
  // payment request cancelled underneath them, and then the move refused.
  const to: ApplicationStatus = target === "decision" ? "awaiting_decision" : "offer_draft";
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: to,
    nextAction: target === "decision" ? "await_decision" : "await_offer",
    event: {
      type: "application.moved_to_stage",
      summary: `${moveTargetLabel(target, "back")} by staff: ${reason}`,
      payload: { from: app.status, to: target, direction: "back", reason },
    },
    resolveTaskTypes: [...BACK_MOOT_TASKS],
    // Back to Decision puts the child in front of whoever decides, as the
    // rules engine's referral does.
    tasks:
      target === "decision" && opts.decideAgainTask !== false
        ? [{ type: "review_decision", title: `Decide again on ${app.child_first_name}'s application`, details: `Moved back to Decision by staff. Reason: ${reason}`, priority: "high" }]
        : [],
    audit: { action: "application.moved_to_stage", before: { status: app.status }, after: { stage: target, direction: "back", reason } },
    actor,
    override: true,
  });

  // Past this point the child has moved, so a failure cannot say "unchanged,
  // try again" as `mustSucceed` does: a second press would be refused by
  // status. It says what is left to do by hand instead.
  const stopped = "was moved back, but its old letter or payment could not be tidied away. Withdraw the old offer under Edit offer, and ask finance to cancel its payment request";
  await withdrawLetters(admin, app, ["draft", "pending_approval", "sent", "viewed", "expired", "accepted"], why, reason, actor, stopped);
  const tidied = await Promise.all([
    admin.from("payment_requests").update({ status: "cancelled" }).eq("application_id", app.id).in("status", ["required", "failed"]),
    admin.from("payments").update({ status: "expired", failure_reason: "Moved back by staff" }).eq("application_id", app.id).eq("status", "pending"),
    admin
      .from("jobs")
      .update({ status: "skipped", last_error: "Moved back by staff", completed_at: new Date().toISOString() })
      .eq("application_id", app.id)
      .eq("status", "pending")
      .in("type", STALE_AFTER_MOVE_BACK),
  ]);
  const tidyErr = tidied.find((r) => r.error)?.error;
  if (tidyErr) throw new WorkflowError(`${app.reference}: ${stopped} (${tidyErr.message}).`, "database");

  let cur = await reload(admin, app.id);
  if (target === "offer") {
    // Blocked on fees is a resting state with its own task, not a failure:
    // the child is at Offer, waiting on a fee schedule. Anything else (no
    // published template, say) is reported as what it is — the child has
    // moved, and pressing Move again would be refused by status.
    try {
      await onOfferDrafted(admin, cur, actor, { conditions: previous?.conditions ?? null, autoApprove: false });
    } catch (e) {
      throw new WorkflowError(
        `${app.child_first_name} was moved back to Offer and the old letter withdrawn, but the new letter could not be drafted: ${(e as Error).message} Once that is fixed, press Create offer on their page.`,
        e instanceof WorkflowError ? e.code : "database"
      );
    }
    cur = await reload(admin, app.id);
  }
  return cur;
}

/**
 * Deferred from the offer stage (`defersThroughDecision`): back to Decision,
 * then the ordinary deferral from there.
 *
 * The move back is the one above, for the reasons it gives: the status first,
 * so a parent accepting in the same second is refused by status, then every
 * letter withdrawn with its own line, unpaid requests closed, and the old
 * letter's queued emails and expiry skipped. Only its "decide again" task is
 * left off. When the family resumes they are at Decision, where the decision
 * is made again (`statusAfterDeferral`).
 *
 * Two commits. If the deferral fails after the move back, the child rests at
 * Decision with the letter withdrawn — a state the page shows plainly, with
 * Defer offered again — and the message says so.
 */
export async function onDeferredAfterDecision(
  admin: AdminClient,
  app: MovingApp & Pick<ApplicationRow, "owner_staff_id">,
  spec: { until: string; reason: string | null },
  actor: Actor
): Promise<void> {
  if (!defersThroughDecision(app.status)) {
    throw new WorkflowError(
      `A child who is "${STATUS_LABELS[app.status]}" cannot be deferred from here. Reload the page: they may have moved on already.`,
      "status_conflict"
    );
  }
  const why = spec.reason ? `Deferred at the family's request: ${spec.reason}` : "Deferred at the family's request";
  const back = await moveBack(admin, app, "decision", why, actor, { decideAgainTask: false });
  try {
    await onDeferred(admin, { ...back, owner_staff_id: app.owner_staff_id }, spec, actor);
  } catch (e) {
    throw new WorkflowError(
      `${app.child_first_name} was moved back to Decision, but could not be deferred: ${(e as Error).message} Defer them again from their page.`,
      e instanceof WorkflowError ? e.code : "database"
    );
  }
}

/**
 * Moves the child to the chosen stage, forward or back. Returns where they
 * landed, which is the stage asked for or (at Payment, when the letter has
 * nothing to pay on acceptance) the one after it, or (back to Offer, when no
 * fee schedule prices the new letter) the draft waiting on fees.
 */
export async function onMovedToStage(admin: AdminClient, app: MovingApp, move: StageMove, actor: Actor): Promise<ApplicationStatus> {
  if (actor.type !== "staff" || !actor.id) {
    throw new WorkflowError("Moving a child on needs a signed-in member of staff.", "illegal_transition");
  }
  const reason = move.reason.trim();
  if (reason.length < 5) throw new WorkflowError("Give a reason of at least a few words.", "illegal_transition");
  const direction = moveDirection(app.status, move.target);
  if (!direction) {
    throw new WorkflowError(
      `A child who is "${STATUS_LABELS[app.status]}" cannot be moved to ${moveTargetLabel(move.target)}. Reload the page: they may have moved on already.`,
      "status_conflict"
    );
  }
  if (direction === "back") return (await moveBack(admin, app, move.target, reason, actor)).status;

  const from = app.status;
  switch (move.target) {
    case "decision":
      return (await toDecision(admin, app, reason, actor, true)).status;
    case "registration":
      return (await toRegistration(admin, app, move, reason, actor)).status;
    case "offer":
    case "payment": {
      // Not the auto-approve switch, even when it is on: an officer moving a
      // child to Offer is told the letter waits for approval, and it does.
      const landed = move.target === "offer" ? await toOffer(admin, app, reason, actor, { autoApprove: false }) : await toPayment(admin, app, reason, actor);
      // The steps pressed on the way each left their own line; this one says
      // why, and closes what the skipped stages left open.
      await commit(admin, {
        applicationId: app.id,
        expectedStatus: null,
        newStatus: null,
        nextAction: null,
        event: {
          type: "application.moved_to_stage",
          summary: `Moved to ${moveTargetLabel(move.target)} by staff: ${reason}`,
          payload: { from, to: move.target, reason, landed: landed.status },
        },
        resolveTaskTypes: mootTaskTypes(move.target),
        audit: { action: "application.moved_to_stage", before: { status: from }, after: { stage: move.target, reason, landed: landed.status } },
        actor,
      });
      return landed.status;
    }
  }
}
