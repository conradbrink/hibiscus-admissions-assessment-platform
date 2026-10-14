import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, ApplicationStatus, OfferRow } from "@/lib/supabase/types";
import { loadApplicationGraph } from "@/lib/applications";
import { resolveFeeSchedule } from "@/lib/offers/render";
import { getSettings } from "@/lib/settings";
import { mustSucceed } from "@/lib/workflow/actions";
import { onStaffDecision } from "@/lib/workflow/decision-actions";
import { commit, WorkflowError, type Actor, type JobSpec, type TaskSpec } from "@/lib/workflow/engine";
import { JOURNEY } from "@/lib/workflow/next-step";
import { hasResults, onOfferAccepted, onOfferApproved, onOfferDrafted, onOfferWithdrawn } from "@/lib/workflow/offer-actions";
import { canMoveTo, moveTargetLabel, mootTaskTypes, movePosition, type MoveTarget } from "@/lib/workflow/stage-move";
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
  const { data: withdrawn, error: offErr } = await admin
    .from("offers")
    .update({ status: "withdrawn", withdrawn_reason: "Moved straight to registration by staff" })
    .eq("application_id", app.id)
    .in("status", ["draft", "pending_approval", "sent", "viewed", "expired"])
    .select("id");
  if (offErr) {
    throw new WorkflowError(`${app.reference} was not moved on: we could not withdraw its offer (${offErr.message}). Its status is unchanged — please try again.`, "database");
  }
  // One line per letter, as `onOfferWithdrawn` writes: it is what the journey
  // bar reads to stop ticking Offer for a letter that is no longer out.
  for (const offer of withdrawn ?? []) {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "offer.withdrawn", summary: "Offer withdrawn: moved straight to registration by staff", payload: { offer_id: offer.id, reason } },
      audit: { action: "offer.withdrawn", entityType: "offer", entityId: offer.id, after: { reason: "Moved straight to registration by staff" } },
      actor,
    });
  }
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
  const jobs: JobSpec[] = [
    {
      type: "send_email",
      payload: { template_key: "registration_open", links: ["registration"] },
      idempotencyKey: `email:${app.id}:registration_open`,
      precondition: { application_status: ["registration_incomplete"] },
    },
    // `registration_open` again, not `registration_reminder`: that one says
    // the place is secured, which the offer's terms tie to paying, and a
    // family moved on by hand may not have.
    ...settings.registrationReminderDays.map((days) => ({
      type: "send_email",
      payload: { template_key: "registration_open", links: ["registration"] },
      idempotencyKey: `email:${app.id}:registration_open:reminder:${days}d`,
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
 * Moves the child forward to the chosen stage. Returns where they landed,
 * which is the stage asked for or (at Payment, when the letter has nothing to
 * pay on acceptance) the one after it.
 */
export async function onMovedToStage(admin: AdminClient, app: MovingApp, move: StageMove, actor: Actor): Promise<ApplicationStatus> {
  if (actor.type !== "staff" || !actor.id) {
    throw new WorkflowError("Moving a child on needs a signed-in member of staff.", "illegal_transition");
  }
  const reason = move.reason.trim();
  if (reason.length < 5) throw new WorkflowError("Give a reason of at least a few words.", "illegal_transition");
  if (!canMoveTo(app.status, move.target)) {
    throw new WorkflowError(
      `A child who is "${STATUS_LABELS[app.status]}" cannot be moved to ${moveTargetLabel(move.target)}. Reload the page: they may have moved on already.`,
      "status_conflict"
    );
  }

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
