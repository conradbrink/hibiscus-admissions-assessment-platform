import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, AttemptRow, BookingRow } from "@/lib/supabase/types";
import { markAttempt } from "@/lib/assessment/mark-attempt";
import { getSettings } from "@/lib/settings";
import { commit, SYSTEM_ACTOR, WorkflowError, type Actor, type JobSpec } from "@/lib/workflow/engine";

/**
 * The sitting, from Launch to a fully marked attempt. Same shape as the
 * actions in ./actions.ts: each is one entry in the event → actions table,
 * expressed as the database writes plus one atomic commit.
 *
 * Booking status moves happen *inside* the launch and submit RPCs, so an
 * attempt and its booking can never disagree. What is left for the commit
 * is the application: its status, the timeline, the jobs.
 */

const emailJob = (applicationId: string, templateKey: string, suffix: string, opts: { links?: string[] } = {}): JobSpec => ({
  type: "send_email",
  payload: { template_key: templateKey, links: opts.links ?? null },
  idempotencyKey: `email:${applicationId}:${templateKey}:${suffix}`,
});

export type LaunchResult = { attemptId: string; timeLimitSeconds: number };

/**
 * Staff taps Launch. Materialises the form, opens the attempt, moves the
 * booking to in_progress, and schedules the expiry sweep that submits (or
 * abandons) the attempt if nobody else does.
 */
export async function onAssessmentLaunched(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  booking: Pick<BookingRow, "id" | "status">,
  opts: { templateId: string; timeMultiplier: number; accommodationNote: string | null },
  actor: Actor
): Promise<LaunchResult> {
  if (booking.status !== "checked_in") {
    throw new WorkflowError(`Booking is ${booking.status}; check the child in first`, "status_conflict");
  }
  const settings = await getSettings(admin);
  const { data: attemptId, error } = await admin.rpc("launch_attempt", {
    p_application_id: app.id,
    p_booking_id: booking.id,
    p_template_id: opts.templateId,
    p_time_multiplier: opts.timeMultiplier,
    p_launched_by: actor.type === "staff" ? (actor.id ?? null) : null,
    p_accommodation_note: opts.accommodationNote,
  });
  if (error) {
    const messages: Record<string, string> = {
      booking_not_checked_in: "The child is not checked in.",
      template_not_active: "That assessment template is not active.",
      template_empty: "The template has no questions for this grade.",
      already_launched: "This child already has an assessment open.",
    };
    const key = Object.keys(messages).find((k) => error.message.includes(k));
    throw new WorkflowError(key ? messages[key] : error.message, key ? "status_conflict" : "database");
  }

  const { data: attempt } = await admin.from("attempts").select("time_limit_seconds").eq("id", attemptId).single();
  const timeLimit = attempt?.time_limit_seconds ?? 3600;
  // The clock starts when the code is typed, not now; the sweep allows for
  // the code's own lifetime plus the sitting plus the grace, plus a margin.
  const sweepAt = new Date(Date.now() + (settings.kioskCodeMinutes * 60 + timeLimit + settings.attemptGraceSeconds + 300) * 1000);

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "assessment_in_progress",
    nextAction: "attend_assessment",
    event: {
      type: "assessment.launched",
      summary: `Assessment launched${opts.timeMultiplier !== 1 ? ` with ${Math.round((opts.timeMultiplier - 1) * 100)}% extra time` : ""}`,
      payload: { attempt_id: attemptId, booking_id: booking.id, time_multiplier: opts.timeMultiplier },
    },
    jobs: [
      {
        type: "expire_attempt",
        payload: { attempt_id: attemptId },
        idempotencyKey: `expire:${attemptId}`,
        runAfter: sweepAt,
        precondition: { attempt_id: attemptId, attempt_status: ["ready", "in_progress"] },
      },
    ],
    audit: { action: "assessment.launched", entityType: "attempt", entityId: attemptId, after: { time_multiplier: opts.timeMultiplier } },
    actor,
  });

  return { attemptId, timeLimitSeconds: timeLimit };
}

/**
 * The child (or the expiry sweep, or staff on the child's behalf) hands the
 * paper in. Submit and complete-the-booking happen in the RPC; then the
 * application moves and marking is queued.
 */
export async function onAssessmentSubmitted(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  attempt: Pick<AttemptRow, "id">,
  opts: { auto: boolean },
  actor: Actor
): Promise<void> {
  const { error } = await admin.rpc("submit_attempt", { p_attempt_id: attempt.id, p_auto: opts.auto });
  if (error) throw new WorkflowError(error.message, error.message.includes("attempt_not_live") ? "status_conflict" : "database");

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "assessment_completed",
    nextAction: "await_results",
    event: {
      type: "assessment.completed",
      summary: opts.auto ? "Assessment time ended; answers submitted automatically" : "Assessment completed",
      payload: { attempt_id: attempt.id, auto: opts.auto },
    },
    jobs: [
      {
        type: "mark_attempt",
        payload: { attempt_id: attempt.id },
        idempotencyKey: `mark:${attempt.id}`,
      },
      emailJob(app.id, "assessment_completed", attempt.id),
    ],
    audit: { action: "assessment.completed", entityType: "attempt", entityId: attempt.id, after: { auto: opts.auto } },
    actor,
  });
}

/**
 * The code expired unused, or staff abandon a sitting that went wrong. The
 * booking returns to checked in so it can be launched again.
 */
export async function onAssessmentAbandoned(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  attempt: Pick<AttemptRow, "id" | "booking_id">,
  reason: string,
  actor: Actor
): Promise<void> {
  const { error } = await admin
    .from("attempts")
    .update({ status: "abandoned" })
    .eq("id", attempt.id)
    .in("status", ["ready", "in_progress"]);
  if (error) throw new WorkflowError(error.message, "database");
  await admin.from("bookings").update({ status: "checked_in" }).eq("id", attempt.booking_id).eq("status", "in_progress");

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "assessment_booked",
    nextAction: "attend_assessment",
    event: { type: "assessment.abandoned", summary: `Assessment abandoned: ${reason}`, payload: { attempt_id: attempt.id, reason } },
    tasks: [
      {
        type: "relaunch_assessment",
        title: `Re-launch assessment for ${app.child_first_name}`,
        details: reason,
        priority: "high",
      },
    ],
    audit: { action: "assessment.abandoned", entityType: "attempt", entityId: attempt.id, after: { reason } },
    actor,
  });
}

/**
 * Marks (or re-marks) an attempt, then does what the result implies: a
 * task for the assessor if writing is waiting, or the move to a decision if
 * everything is marked. Safe to call repeatedly.
 */
export async function runMarking(admin: AdminClient, attemptId: string, actor: Actor = SYSTEM_ACTOR): Promise<void> {
  const outcome = await markAttempt(admin, attemptId);
  const attempt = outcome.attempt;
  const { data: app, error } = await admin
    .from("applications")
    .select("id, status, child_first_name")
    .eq("id", attempt.application_id)
    .single();
  if (error || !app) throw new WorkflowError(error?.message ?? "application missing", "database");

  if (!outcome.complete) {
    // Only open the assessor's task once, however many times marking runs.
    const { data: open } = await admin
      .from("tasks")
      .select("id")
      .eq("application_id", app.id)
      .eq("type", "mark_writing")
      .eq("status", "open")
      .limit(1);
    if (open?.length) return;

    const { data: session } = await admin
      .from("bookings")
      .select("sessions(assessor_staff_id)")
      .eq("id", attempt.booking_id)
      .maybeSingle();
    const s = session?.sessions ? (Array.isArray(session.sessions) ? session.sessions[0] : session.sessions) : null;
    const assessorId = (s as { assessor_staff_id: string | null } | null)?.assessor_staff_id ?? null;

    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: {
        type: "assessment.awaiting_marking",
        summary: `${outcome.awaiting.length} written response${outcome.awaiting.length === 1 ? "" : "s"} waiting for an assessor${outcome.unmarkable.length ? `; ${outcome.unmarkable.length} question${outcome.unmarkable.length === 1 ? "" : "s"} with an unusable key` : ""}`,
        payload: { attempt_id: attemptId, awaiting: outcome.awaiting, unmarkable: outcome.unmarkable },
      },
      tasks: [
        {
          type: "mark_writing",
          title: `Mark ${app.child_first_name}'s written responses`,
          details: outcome.unmarkable.length
            ? "Some questions could not be marked automatically because their answer key is incomplete. Award those marks by hand and tell an author."
            : "Read the writing, pick the rubric band, confirm the marks.",
          priority: "high",
          assigneeStaffId: assessorId,
        },
      ],
      jobs: outcome.awaiting.map((formQuestionId) => ({
        type: "suggest_writing_band",
        payload: { attempt_id: attemptId, form_question_id: formQuestionId },
        idempotencyKey: `suggest:${attemptId}:${formQuestionId}`,
      })),
      actor,
    });
    return;
  }

  if (app.status !== "assessment_completed") return; // already moved on, or a re-mark after the decision
  await onAssessmentMarked(admin, app, attempt, actor);
}

/** Every item marked: the application moves to a decision, and the two follow-ups are queued. */
export async function onAssessmentMarked(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  attempt: Pick<AttemptRow, "id">,
  actor: Actor
): Promise<void> {
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "awaiting_decision",
    nextAction: "await_decision",
    event: { type: "assessment.marked", summary: "Assessment marked; awaiting decision", payload: { attempt_id: attempt.id } },
    resolveTaskTypes: ["mark_writing"],
    jobs: [
      { type: "evaluate_admission", payload: { attempt_id: attempt.id }, idempotencyKey: `evaluate:${attempt.id}` },
      { type: "generate_learning_profile", payload: { attempt_id: attempt.id }, idempotencyKey: `profile:${attempt.id}` },
    ],
    audit: { action: "assessment.marked", entityType: "attempt", entityId: attempt.id },
    actor,
  });
}

/**
 * An assessor records marks against a rubric (or by hand for an item whose
 * key was unusable). Requires a signed-in member of staff; the marks are
 * stamped with who gave them. Marking then re-runs, and if nothing is left
 * the application moves on.
 */
export async function onWritingMarked(
  admin: AdminClient,
  attempt: Pick<AttemptRow, "id" | "status">,
  marks: Array<{ responseId: string; marksAwarded: number }>,
  actor: Actor
): Promise<void> {
  if (actor.type !== "staff" || !actor.id) {
    throw new WorkflowError("Marking needs a signed-in member of staff", "illegal_transition");
  }
  if (attempt.status !== "submitted" && attempt.status !== "marked") {
    throw new WorkflowError("This attempt has not been submitted", "status_conflict");
  }
  for (const m of marks) {
    const { error } = await admin
      .from("attempt_responses")
      .update({
        marks_awarded: m.marksAwarded,
        is_correct: null,
        marking_method: "rubric",
        marked_by: actor.id,
        marked_at: new Date().toISOString(),
      })
      .eq("id", m.responseId)
      .eq("attempt_id", attempt.id);
    if (error) throw new WorkflowError(error.message, "database");
  }
  await runMarking(admin, attempt.id, actor);
}
