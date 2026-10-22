"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { normaliseEmail, tidyName } from "@/lib/contacts";
import { toSchoolDateString } from "@/lib/format-date";
import { isPlausibleDateOfBirth } from "@/lib/grades";
import { removeDocumentObjects } from "@/lib/documents/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCompanionMessage } from "@/lib/messaging/send";
import { saysAssessment } from "@/lib/messaging/template-checks";
import { generateSummary } from "@/lib/summary/generate";
import { clearPromotion, promotionOn, recordPromotion } from "@/lib/promotions/load";
import { awardLabelOf, isScholarshipCode } from "@/lib/promotions/scholarship";
import { discountLabelOf, isStaffDiscountCode } from "@/lib/promotions/discount";
import { can } from "@/lib/permissions";
import { isMonthStart } from "@/lib/start-month";
import { letterInPlay, letterPricedElsewhere, onStartMonthChanged, reissueLetter, requirePriceable } from "@/lib/workflow/reprice-actions";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { offerTrialWeek, recordTrialWeekOutcome } from "@/lib/workflow/trial-week";
import { requireStaffAction } from "@/lib/staff/session";
import { getSettings } from "@/lib/settings";
import { mintToken } from "@/lib/tokens";
import { mobileNumber } from "@/lib/validation";
import {
  onBookingCancelled,
  onCallbackCompleted,
  onCheckedIn,
  onDeferralEnded,
  onDeferred,
  onManualDecision,
  onNoShow,
  onOwnerAssigned,
  onSessionChosen,
  onWithdrawn,
} from "@/lib/workflow/actions";
import { commit } from "@/lib/workflow/engine";
import { isFutureDate } from "@/lib/workflow/deferral";
import { onDeferredAfterDecision, onMovedToStage } from "@/lib/workflow/stage-move-actions";
import { defersThroughDecision, mayMoveTo, moveDirection, moveTargetLabel } from "@/lib/workflow/stage-move";
import { loadApplicationGraph } from "@/lib/applications";
import { isNextAction, statusAfterBooking, type NextAction } from "@/lib/workflow/states";
import type { ApplicationRow, ApplicationStatus } from "@/lib/supabase/types";
import { WITHDRAWN_REASON_CODES } from "@/lib/workflow/withdrawal";

/**
 * Staff actions on one applicant. Each checks the permission, loads the
 * current row (so the engine's expected-status check catches a stale
 * screen), and goes through the engine.
 *
 * The application is read through the caller's own client first
 * (`loadApplicationForStaff`), so campus scoping applies to the action as
 * it does to the page; the engine call that follows uses the admin client.
 */

async function loadLiveBooking(admin: ReturnType<typeof createAdminClient>, applicationId: string) {
  const { data } = await admin
    .from("bookings")
    .select("*")
    .eq("application_id", applicationId)
    .in("status", ["booked", "checked_in", "in_progress"])
    .maybeSingle();
  return data;
}

function done(applicationId: string) {
  revalidatePath(`/staff/applications/${applicationId}`);
  revalidatePath("/staff/applications");
  revalidatePath("/staff/assessments/today");
  revalidatePath("/staff/tasks");
  revalidatePath("/staff");
}

const idSchema = z.object({ applicationId: z.guid() });

export async function assignOwner(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ ownerStaffId: z.string() }).parse(Object.fromEntries(formData));
    const { admin } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const ownerId = parsed.ownerStaffId || null;
    let name: string | null = null;
    if (ownerId) {
      const { data } = await admin.from("staff_profiles").select("full_name").eq("id", ownerId).single();
      name = data?.full_name ?? null;
    }
    await onOwnerAssigned(admin, parsed.applicationId, ownerId, name, ctx.actor);
    done(parsed.applicationId);
  });
}

export async function addNote(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ body: z.string().trim().min(1).max(4000) }).parse(Object.fromEntries(formData));
    // Through the staff client: RLS pins the author and checks the campus.
    const { error } = await ctx.supabase
      .from("notes")
      .insert({ application_id: parsed.applicationId, author_staff_id: ctx.userId, body: parsed.body });
    if (error) throw new Error(error.message);
    done(parsed.applicationId);
  });
}

export async function checkIn(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.deliver");
    const { applicationId } = idSchema.parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, applicationId);
    const booking = await loadLiveBooking(admin, applicationId);
    if (!booking) throw new Error("No live booking to check in.");
    await onCheckedIn(admin, app, booking, ctx.actor);
    done(applicationId);
  });
}

export async function markNoShow(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.deliver");
    const { applicationId } = idSchema.parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, applicationId);
    const booking = await loadLiveBooking(admin, applicationId);
    if (!booking) throw new Error("No live booking.");
    await onNoShow(admin, app, booking, ctx.actor);
    drainSoon();
    done(applicationId);
  });
}

export async function cancelBookingByStaff(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ reason: z.string().trim().max(300).optional() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const booking = await loadLiveBooking(admin, parsed.applicationId);
    if (!booking) throw new Error("No live booking.");
    await onBookingCancelled(admin, app, booking, parsed.reason || "Cancelled by staff", ctx.actor);
    done(parsed.applicationId);
  });
}

export async function rescheduleByStaff(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ sessionId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const booking = await loadLiveBooking(admin, parsed.applicationId);
    const { data: session } = await admin.from("sessions").select("id, kind, starts_at").eq("id", parsed.sessionId).single();
    if (!session) throw new Error("Session not found");
    // A first assessment booking only while booking one is still the stage.
    // From later on (sat and waiting for a decision, an offer out) the
    // booking would be made, its confirmation and reminders queued, and the
    // status left where it was: a second sitting nobody asked for.
    if (session.kind === "assessment" && !booking && statusAfterBooking(app.status, "assessment") === null) {
      throw new Error("This child is past the assessment stage, so an assessment cannot be booked for them here.");
    }
    try {
      await onSessionChosen(admin, app, booking, session, ctx.actor);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("session_wrong_campus")) throw new Error("That session is at a different campus from the one the child applied to.");
      if (msg.includes("session_full")) throw new Error("That session is full.");
      if (msg.includes("grade_not_in_range")) throw new Error("That session is for a different age group.");
      throw e;
    }
    drainSoon();
    done(parsed.applicationId);
  });
}

/**
 * How the free trial week went, from the applicant's own page.
 *
 * The same four moves the review queue offers, and the same permission: a
 * week is offered and closed out by whoever is looking at the child, and
 * which screen that is should not decide whether they can finish the job.
 * `done` rather than the queue's `refresh`, so it is this page that is
 * revalidated.
 */
export async function trialWeekOutcome(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("decisions.override");
    const p = z
      .object({
        applicationId: z.guid(),
        trialId: z.guid(),
        status: z.enum(["confirmed", "attended", "no_show", "cancelled"]),
        note: z.string().trim().max(500).optional().or(z.literal("")),
      })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    await recordTrialWeekOutcome(admin, app, p.trialId, p.status, p.note || null, ctx.actor);
    done(p.applicationId);
  });
}

/**
 * Every "what happens to this family" answer: approve, waitlist, decline,
 * "not now" and "not at all".
 *
 * Deferring and withdrawing live here because they are choices staff make at
 * that moment, not separate filing actions — but neither overrides the rules
 * engine, so both keep the permission their own buttons carried before they
 * moved in: anybody who may edit an applicant may promise to ring a family
 * back or close their application, while approving still needs
 * decisions.override.
 *
 * Waitlist and decline were taken out of this form once, and put back on
 * 13 October 2026 at the school's request: a person deciding from the
 * child's own page needs every answer the review queue has. They are in the
 * enum and the dropdown together, because an outcome that can be posted but
 * not chosen (or chosen but not posted) is worse than either. Like approve,
 * both need decisions.override and a reason. The letter goes when somebody
 * presses Send under Admissions → Offer, or at once if the auto_send_outcomes
 * switch is on, and the form says which.
 */
export async function recordDecision(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const raw = Object.fromEntries(formData);
    const outcome = z.enum(["trial_week", "approved", "waitlisted", "declined", "deferred", "withdrawn"]).parse(raw.outcome);
    const paused = outcome === "deferred" || outcome === "withdrawn";
    const ctx = await requireStaffAction(paused ? "applications.write" : "decisions.override");

    // The free trial week shares this form because it is one of the things a
    // person chooses between while looking at an undecided child — but it is
    // not a decision and writes none. It invites the family and leaves the
    // application where it is, exactly as the review queue's own button does.
    if (outcome === "trial_week") {
      const parsed = idSchema
        .extend({
          startsOn: z.string().trim(),
          endsOn: z.string().trim().optional().or(z.literal("")),
          note: z.string().trim().max(500).optional().or(z.literal("")),
        })
        .parse(raw);
      const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
      await offerTrialWeek(admin, app, {
        startsOn: parsed.startsOn,
        endsOn: parsed.endsOn || null,
        note: parsed.note || null,
        actor: ctx.actor,
      });
      // The invitation is a job; run the queue now so the email goes while the
      // person is still looking at the screen.
      drainSoon();
      done(parsed.applicationId);
      return;
    }

    if (outcome === "withdrawn") {
      // The code is required and the note is not. It is the other way round
      // from how it reads: the note is often the useful half, but it is the
      // code that can be counted, and a pick-list nobody has to fill in is a
      // pick-list of "other".
      const parsed = idSchema
        .extend({
          reasonCode: z.enum(WITHDRAWN_REASON_CODES),
          reason: z.string().trim().min(3).max(500),
        })
        .parse(raw);
      const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
      await onWithdrawn(admin, app, parsed.reason, ctx.actor, parsed.reasonCode);
      done(parsed.applicationId);
      return;
    }

    if (outcome === "deferred") {
      const parsed = idSchema
        .extend({
          until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
          reason: z.string().trim().max(500).optional(),
          seenStatus: z.string().optional(),
        })
        .parse(raw);
      // A date in the past is a typo, and the follow-ups for it would all be
      // dropped as already gone — leaving a paused application nothing would
      // ever wake.
      if (!isFutureDate(parsed.until)) throw new Error("Choose a date in the future.");
      const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
      const spec = { until: parsed.until, reason: parsed.reason?.trim() || null };
      const throughDecision = defersThroughDecision(app.status);
      // The page posts the status it showed, and the confirmation it asked
      // for was written for that status. A child sent an offer while it was
      // open would otherwise lose the letter on a confirmation that never
      // mentioned it. A form from before this field fails closed only where a
      // letter is at stake.
      if (parsed.seenStatus ? parsed.seenStatus !== app.status : throughDecision) {
        throw new Error(`${app.child_first_name} has moved since this page was loaded. Reload the page and choose again.`);
      }
      if (throughDecision) {
        // The move back to Decision, so exactly what that move needs.
        if (!mayMoveTo(ctx.permissions, "decision", "back")) {
          throw new Error("Deferring a family at the offer stage moves them back to Decision and withdraws their offer, and your account cannot do that.");
        }
        try {
          await onDeferredAfterDecision(admin, app, spec, ctx.actor);
        } finally {
          // Even part way: the move back may have happened, and the page and
          // the Offers board should show where the child is now.
          done(parsed.applicationId);
          revalidatePath("/staff/offers");
          revalidatePath("/staff/decisions");
        }
        return;
      }
      await onDeferred(admin, app, spec, ctx.actor);
      done(parsed.applicationId);
      return;
    }

    const parsed = idSchema
      .extend({ reason: z.string().trim().min(5, "Give a reason of at least a few words.").max(1000) })
      .parse(raw);
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    await onManualDecision(admin, app, outcome, parsed.reason, ctx.actor);
    // An approval queues the offer draft; a waitlist or decline opens the
    // "send outcome" task. Run the queue now rather than on the next sweep,
    // so the child is on the offers board when staff look, and refresh the
    // two lists the child has just left and joined.
    drainSoon();
    done(parsed.applicationId);
    revalidatePath("/staff/decisions");
    revalidatePath("/staff/offers");
  });
}

/**
 * The review queue's answer: approve, waitlist or decline.
 *
 * Its own action rather than `recordDecision` above, the applicant page's
 * form, because the queue offers only these three. The queue once posted
 * Waitlist and Decline to that form's action while it refused them, so both
 * were turned away with "Some of what was entered is not valid" and no
 * applicant could be waitlisted or declined by a person anywhere in the
 * console. Found on the 14 September 2026 walkthrough. (The applicant page
 * offers both again since 13 October 2026.)
 *
 * Every outcome here is an override of (or a stand-in for) the rules engine,
 * so all three need `decisions.override`, and a reason, which is audited.
 */
export async function recordReviewOutcome(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("decisions.override");
    const parsed = idSchema
      .extend({
        outcome: z.enum(["approved", "waitlisted", "declined"]),
        reason: z.string().trim().min(5, "Give a reason of at least a few words.").max(1000),
      })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    await onManualDecision(admin, app, parsed.outcome, parsed.reason, ctx.actor);
    // An approval queues the offer draft; a waitlist or decline opens the
    // "send outcome" task. Run the queue now so the Offers page is current.
    drainSoon();
    done(parsed.applicationId);
    revalidatePath("/staff/decisions");
    revalidatePath("/staff/offers");
  });
}

export async function completeCallback(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ note: z.string().trim().max(1000).optional() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    await onCallbackCompleted(admin, app, parsed.note || null, ctx.actor);
    done(parsed.applicationId);
  });
}

/**
 * Move to stage: an admissions officer moves the child forward along the
 * journey, skipping the steps between, or back to Decision or Offer, with a
 * reason. Its own permission
 * (`applications.move_stage`) rather than `decisions.override`, because it
 * also speaks for the family (an acceptance) and for finance (a payment
 * request closed or left for them), and a school may want those apart.
 */
export async function moveToStage(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.move_stage");
    const parsed = idSchema
      .extend({
        target: z.enum(["decision", "offer", "payment", "registration"], { error: "Choose the stage to move to." }),
        reason: z.string().trim().min(5, "Give a reason of at least a few words.").max(1000),
        alreadyPaid: z.literal("on").optional(),
        direction: z.enum(["forward", "back"]).optional(),
      })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const way = moveDirection(app.status, parsed.target);
    // The page posts the way the officer saw. A child who moved on while it
    // was open would otherwise turn a confirmed "Move to Decision" into a
    // move back that withdraws their letter, with no warning.
    if (parsed.direction && parsed.direction !== way) {
      throw new Error(
        way
          ? `${app.child_first_name} has moved since this page was loaded, so this would now be ${way === "back" ? "a move back" : "a move forward"}. Reload the page and choose again.`
          : `${app.child_first_name} has moved since this page was loaded and can no longer be moved ${parsed.direction === "back" ? "back " : ""}to ${moveTargetLabel(parsed.target)}. Reload the page.`
      );
    }
    const direction = way ?? "forward";
    if (!mayMoveTo(ctx.permissions, parsed.target, direction)) {
      throw new Error(
        direction === "back"
          ? `Moving a child ${moveTargetLabel(parsed.target, "back").toLowerCase()} withdraws their offer, and your account cannot do that.`
          : `Moving a child to ${moveTargetLabel(parsed.target)} also approves on the way, and your account cannot do that.`
      );
    }
    await onMovedToStage(admin, app, { target: parsed.target, reason: parsed.reason, alreadyPaid: parsed.alreadyPaid === "on" }, ctx.actor);
    // The emails the stage landed on sends, now rather than on the next sweep.
    drainSoon();
    done(app.id);
    revalidatePath("/staff/decisions");
    revalidatePath("/staff/offers");
    revalidatePath("/staff/payments");
    revalidatePath("/staff/registrations");
  });
}

/** Back from a deferral: the family answered, or staff picked it up early. */
export async function resumeDeferred(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const { applicationId } = idSchema.parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, applicationId);
    await onDeferralEnded(admin, app, ctx.actor);
    done(applicationId);
  });
}

/** Queues a fresh "your next step" link to the parent. */
export async function resendLink(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const { applicationId } = idSchema.parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, applicationId);
    await commit(admin, {
      applicationId,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "link.resent", summary: "Fresh link sent by staff" },
      jobs: [
        {
          type: "send_email",
          payload: { template_key: "fresh_link" },
          idempotencyKey: `email:${app.id}:fresh_link:staff:${Date.now()}`,
        },
      ],
      audit: { action: "link.resent" },
      actor: ctx.actor,
    });
    drainSoon();
    done(applicationId);
  });
}

/** Shows staff the current link without emailing — for a parent on the phone. */
export async function generateLinkForStaff(_: StaffActionState, formData: FormData): Promise<StaffActionState & { url?: string }> {
  try {
    const ctx = await requireStaffAction("applications.write");
    const { applicationId } = idSchema.parse(Object.fromEntries(formData));
    const { admin } = await loadApplicationForStaff(ctx, applicationId);
    const settings = await getSettings(admin);
    const link = await mintToken(admin, {
      applicationId,
      purpose: "next_step",
      ttlDays: settings.bookingTokenDays,
      reason: `staff:${ctx.profile.email}`,
    });
    await commit(admin, {
      applicationId,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "link.generated", summary: "Link generated by staff to share directly" },
      audit: { action: "link.generated" },
      actor: ctx.actor,
    });
    done(applicationId);
    return { ok: true, url: link.url };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * A task about this applicant, written by a person.
 *
 * The same permission as the tasks page — `tasks.write`, which Management
 * holds and no other write. The campus comes from the applicant rather than a
 * picker: a task about this child belongs to the campus this child applied
 * to, and that is also what scopes who can see it.
 */
export async function addApplicantTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("tasks.write");
    const parsed = idSchema
      .extend({
        title: z.string().trim().min(3, "Give the task a title.").max(200),
        details: z.string().trim().max(2000).optional(),
        assigneeStaffId: z.string().optional(),
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
        priority: z.enum(["low", "normal", "high"]).default("normal"),
      })
      .parse(Object.fromEntries(formData));
    const { app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const { error } = await ctx.supabase.from("tasks").insert({
      application_id: app.id,
      campus_id: app.campus_id,
      type: "staff_task",
      title: parsed.title,
      details: parsed.details || null,
      priority: parsed.priority,
      // 07:00 at the campus, so "due Friday" is the start of Friday rather
      // than midnight, which the overdue filter reads as Thursday night.
      due_at: parsed.dueOn ? `${parsed.dueOn}T07:00:00+02:00` : null,
      assignee_staff_id: parsed.assigneeStaffId || null,
      created_by_type: "staff",
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
    done(parsed.applicationId);
    revalidatePath("/staff/tasks");
  });
}

export async function completeTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = z.object({ taskId: z.guid(), note: z.string().trim().max(500).optional(), applicationId: z.guid().optional() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("tasks")
      .update({
        status: "done",
        resolved_at: new Date().toISOString(),
        resolved_by: ctx.userId,
        resolution_note: parsed.note || null,
      })
      .eq("id", parsed.taskId)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    if (parsed.applicationId) done(parsed.applicationId);
    revalidatePath("/staff/tasks");
    revalidatePath("/staff");
  });
}

export async function assignTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = z.object({ taskId: z.guid(), assigneeStaffId: z.string(), applicationId: z.guid().optional() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("tasks")
      .update({ assignee_staff_id: parsed.assigneeStaffId || null })
      .eq("id", parsed.taskId);
    if (error) throw new Error(error.message);
    if (parsed.applicationId) done(parsed.applicationId);
    revalidatePath("/staff/tasks");
  });
}

/**
 * A WhatsApp message by hand: one of the approved templates, nothing
 * typed. Goes through the same sender as the companion messages, so the
 * record and the opt-in check are the same.
 */
export async function sendWhatsAppTemplate(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ templateKey: z.string().regex(/^[a-z0-9_]+$/) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    // The picker already hides these, but a form post is not obliged to have
    // come from our form — and this is the send that actually reached a
    // pre-school parent as "Brock's assessment at Phase 2 is booked".
    if (!app.requires_assessment) {
      const { data: template } = await admin
        .from("message_templates")
        .select("body_preview")
        .eq("key", parsed.templateKey)
        .maybeSingle();
      if (saysAssessment(template?.body_preview)) {
        throw new Error("That wording says “assessment”, and this child does not sit one. Pick the visit version.");
      }
    }
    const verdict = await enforceRateLimit(admin, LIMITS.staffMessage, ctx.userId);
    if (!verdict.ok) throw new Error("Too many messages in a short time. Please wait a little.");
    const result = await sendCompanionMessage(admin, {
      applicationId: app.id,
      templateKey: parsed.templateKey,
      // One manual send of a template per applicant per minute, however many clicks.
      idempotencyKey: `whatsapp:manual:${app.id}:${parsed.templateKey}:${Math.floor(Date.now() / 60_000)}`,
      trigger: "manual",
      // Named on the message's own trail, not just in `audit_log`: when the
      // office is looking at why a parent got something, the question is
      // always about that message.
      actorId: ctx.userId,
      actorLabel: ctx.actor.label ?? null,
    });
    if (result.status === "failed") throw new Error(`Not sent: ${result.error}`);
    if (result.status === "skipped") throw new Error(`Not sent: ${result.reason}.`);
    await admin.from("audit_log").insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.actor.label ?? null,
      action: "message.sent_manually",
      entity_type: "message",
      entity_id: result.messageId,
      application_id: app.id,
      after: { template_key: parsed.templateKey },
    });
    done(parsed.applicationId);
  });
}

/** Staff record a parent's spoken wish about WhatsApp; audited under their name. */
export async function setWhatsAppOptInByStaff(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ optIn: z.enum(["0", "1"]) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const optIn = parsed.optIn === "1";
    const { error } = await admin
      .from("contacts")
      .update(
        optIn
          ? { whatsapp_opt_in: true, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_in_source: "staff", whatsapp_opt_out_at: null }
          : { whatsapp_opt_in: false, whatsapp_opt_out_at: new Date().toISOString() }
      )
      .eq("id", app.contact_id);
    if (error) throw new Error(error.message);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: optIn ? "messaging.opted_in" : "messaging.opted_out", summary: optIn ? "WhatsApp updates turned on by staff at the parent's request" : "WhatsApp updates turned off by staff" },
      audit: { action: optIn ? "contact.whatsapp_opt_in" : "contact.whatsapp_opt_out", entityType: "contact", entityId: app.contact_id },
      actor: ctx.actor,
    });
    done(parsed.applicationId);
  });
}

/** Regenerate the applicant summary. The facts and flags come from code; the prose from the model only when switched on. */
export async function refreshSummary(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.read");
    const { applicationId } = idSchema.parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, applicationId);
    const verdict = await enforceRateLimit(admin, LIMITS.summary, ctx.userId);
    if (!verdict.ok) throw new Error("Too many refreshes in a short time. Please wait a little.");
    await generateSummary(admin, app.id, ctx.userId);
    revalidatePath(`/staff/applications/${app.id}`);
    revalidatePath("/staff/applications");
  });
}

/**
 * The stage a child is joining, changed by hand.
 *
 * The date of birth suggests it and the parent confirms it, but a family
 * transferring mid-year, a school report that arrives late, or a child who
 * has repeated a year all mean the answer is a person's, not a formula's.
 *
 * The grade decides which assessment paper is drawn and which fee schedule
 * the offer uses, so it is refused once the child is enrolled — by then the
 * record has left for the school's own system, and changing it here would
 * only make the two disagree. The recommendation from the date of birth is
 * left alone, so the two can still be compared.
 */
export async function changeGrade(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ gradeId: z.guid(), reason: z.string().trim().max(300).optional() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    if (app.grade_id === parsed.gradeId) return;
    if (app.status === "enrolled") {
      throw new Error("This child is enrolled, so the stage is now the school system's to change.");
    }

    const [{ data: to }, { data: from }, { data: offered }] = await Promise.all([
      admin.from("grades").select("id, name").eq("id", parsed.gradeId).maybeSingle(),
      admin.from("grades").select("id, name").eq("id", app.grade_id).maybeSingle(),
      admin.from("campus_grades").select("grade_id").eq("campus_id", app.campus_id).eq("grade_id", parsed.gradeId).eq("is_active", true).maybeSingle(),
    ]);
    if (!to) throw new Error("That stage does not exist.");
    if (!offered) throw new Error(`${to.name} is not taught at this campus. Change the campus first, or choose another stage.`);

    const requires = await requiresAssessmentAt(admin, app.campus_id, parsed.gradeId);
    const { error } = await admin
      .from("applications")
      .update({ grade_id: parsed.gradeId, requires_assessment: requires })
      .eq("id", app.id);
    if (error) throw new Error(error.message);

    const track = trackAfterFlagChange(app, requires);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: track?.status ?? null,
      // The stage changes; where the application is in the pipeline does not,
      // unless the new stage adds or removes the assessment (see
      // `trackAfterFlagChange`). `next_action` is a plain string on the row
      // and the engine wants its own union, so it is narrowed through the
      // shared guard.
      nextAction: track?.nextAction ?? (isNextAction(app.next_action) ? app.next_action : null),
      event: {
        type: "application.grade_changed",
        summary: `Stage changed from ${from?.name ?? "unknown"} to ${to.name}${parsed.reason ? ` — ${parsed.reason}` : ""}${track?.note ?? ""}`,
        payload: { from: from?.name ?? null, to: to.name, reason: parsed.reason ?? null, requires_assessment: requires },
      },
      audit: {
        action: "application.grade_changed",
        before: { grade: from?.name ?? null, requires_assessment: app.requires_assessment },
        after: { grade: to.name, reason: parsed.reason ?? null, requires_assessment: requires },
      },
      actor: ctx.actor,
    });
    done(app.id);
  });
}

/**
 * Whether a class is assessed at a campus: the campus's own override, else
 * the grade's rule. The same question `loadCatalogue` answers for the parent's
 * grade step; asked again here because a stage changed by hand used to keep
 * the flag it was born with, so a Reception child moved to Stage 1 at Block 7
 * was never asked to sit the paper and a Stage 1 child moved to Reception
 * was.
 */
async function requiresAssessmentAt(admin: ReturnType<typeof createAdminClient>, campusId: string, gradeId: string): Promise<boolean> {
  const [{ data: link }, { data: grade }] = await Promise.all([
    admin.from("campus_grades").select("requires_assessment").eq("campus_id", campusId).eq("grade_id", gradeId).maybeSingle(),
    admin.from("grades").select("requires_assessment").eq("id", gradeId).maybeSingle(),
  ]);
  return link?.requires_assessment ?? grade?.requires_assessment ?? false;
}

/**
 * Where a change of class puts the application when it changes whether the
 * child sits an assessment. Only the two early resting states move: an
 * unrouted or booking-track enquiry that no longer needs a sitting goes to
 * the decision, and a child waiting on a decision who now needs one goes back
 * to book it. Anything later — a sitting under way, an offer out — is left
 * where it is for a person to sort out, and the flag alone changes.
 */
function trackAfterFlagChange(
  app: Pick<ApplicationRow, "status" | "requires_assessment">,
  requires: boolean
): { status: ApplicationStatus; nextAction: NextAction; note: string } | null {
  if (requires === app.requires_assessment) return null;
  if (!requires && app.status === "new_enquiry") {
    return { status: "awaiting_decision", nextAction: "await_school_contact", note: " — no assessment for this class; now waiting for a decision" };
  }
  if (requires && (app.status === "awaiting_decision" || app.status === "staff_review")) {
    return { status: "new_enquiry", nextAction: "book_assessment", note: " — this class sits an assessment; the family can now book one" };
  }
  return null;
}

/**
 * The campus a child is applying to, changed by hand.
 *
 * A family who chose the wrong campus, or moved house, could not be moved:
 * `changeGrade` said "Change the campus first" and nothing did. The campus,
 * and with it the grade if the new campus does not teach the old one, the
 * assessment flag, and the open tasks (which are what scope who sees the
 * work) all follow. A live booking is at the old campus and has to be
 * cancelled or moved first — a sitting cannot change building on its own.
 *
 * Until 22 October 2026 this was refused once a decision existed, and told
 * staff to withdraw the offer first — but withdrawing leaves the child at
 * `offer_draft`, which was refused too, so a family could not be moved at
 * all after the decision. The letter, the fees and the bank details are the
 * campus's, so a letter in play is now re-priced at the new campus in the
 * same step, as the starting month is (`reissueLetter`). Once the family has
 * accepted, the campus is part of what they agreed to and paid against.
 */
export async function changeCampus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema
      .extend({ campusId: z.guid(), gradeId: z.union([z.guid(), z.literal("")]).optional(), reason: z.string().trim().max(300).optional() })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    if (app.campus_id === parsed.campusId && (!parsed.gradeId || parsed.gradeId === app.grade_id)) {
      // Already at this campus. Unless the move was saved and its re-draft
      // failed, leaving the letter priced at the old campus: then the
      // re-draft is what is left to do, and pressing the button again does it.
      const play = await letterInPlay(admin, app);
      if (!(await letterPricedElsewhere(admin, play, app.campus_id))) return;
      if (!can(ctx.permissions, "offers.approve")) {
        throw new Error("This child's offer is still priced at the old campus. Ask someone who approves offers to move them again, which re-drafts it.");
      }
      await reissueLetter(admin, app, play, "Re-priced at the campus already set", ctx.actor);
      drainSoon();
      revalidatePath("/staff/offers");
      done(app.id);
      return;
    }
    const agreedStages: ApplicationStatus[] = [
      "offer_accepted", "payment_required", "payment_processing", "paid", "registration_incomplete", "registration_complete", "enrolled",
    ];
    if (agreedStages.includes(app.status)) {
      throw new Error("The family has accepted the offer, so the campus is set. To move them, take them back to Offer with Move to stage first.");
    }
    if (app.status === "offer_declined") throw new Error("The family declined the offer. Take them back with Move to stage before moving them.");
    // A letter already written is re-priced at the new campus, which is the
    // offer approver's to do, as re-pricing it for a scholarship is.
    const play = await letterInPlay(admin, app);
    if (play.reDraft && !can(ctx.permissions, "offers.approve")) {
      throw new Error("This child's offer is already written. Moving campus re-drafts it, so ask someone who approves offers to move them.");
    }
    // Through the caller's own client: a campus administrator may move a
    // family only between campuses they can see.
    const { data: allowed } = await ctx.supabase.from("v_accessible_campuses").select("id, name").eq("id", parsed.campusId).maybeSingle();
    if (!allowed) throw new Error("You do not have access to that campus.");
    const { data: live } = await admin
      .from("bookings")
      .select("id")
      .eq("application_id", app.id)
      .in("status", ["booked", "checked_in", "in_progress"])
      .maybeSingle();
    if (live) throw new Error("Cancel or move the booking first: it is at the current campus.");

    const gradeId = parsed.gradeId || app.grade_id;
    const [{ data: offered }, { data: to }, { data: fromCampus }, { data: grade }] = await Promise.all([
      admin.from("campus_grades").select("grade_id").eq("campus_id", parsed.campusId).eq("grade_id", gradeId).eq("is_active", true).maybeSingle(),
      admin.from("campuses").select("id, name, intake_cadence").eq("id", parsed.campusId).maybeSingle(),
      admin.from("campuses").select("id, name").eq("id", app.campus_id).maybeSingle(),
      admin.from("grades").select("id, name, sort_order").eq("id", gradeId).maybeSingle(),
    ]);
    if (!to) throw new Error("That campus does not exist.");
    const toCadence = to.intake_cadence;
    if (!offered || !grade) throw new Error(`${to.name} does not teach ${grade?.name ?? "that stage"}. Choose a stage it offers.`);
    // Before anything changes: a family's letter is withdrawn only when the
    // new campus can price the one that replaces it.
    if (play.reDraft) {
      const { data: intake, error: intakeErr } = await admin.from("intakes").select("academic_year_id").eq("id", app.intake_id).single();
      if (intakeErr) throw new Error(intakeErr.message);
      await requirePriceable(admin, { campusId: parsed.campusId, academicYearId: intake.academic_year_id, gradeSort: grade.sort_order });
    }

    const requires = await requiresAssessmentAt(admin, parsed.campusId, gradeId);
    const { error } = await admin
      .from("applications")
      // A month belongs to a campus that runs by the month. Moving the child
      // to a termly campus drops it, or the letter would tell that family the
      // campus takes children in by the month.
      .update({ campus_id: parsed.campusId, grade_id: gradeId, requires_assessment: requires, ...(toCadence === "month" ? {} : { start_month: null }) })
      .eq("id", app.id);
    if (error) throw new Error(error.message);
    // Open work follows the child: a task is scoped by its campus, and a task
    // left behind at the old campus is one nobody at the new campus can see.
    await admin.from("tasks").update({ campus_id: parsed.campusId }).eq("application_id", app.id).eq("status", "open");

    const track = trackAfterFlagChange(app, requires);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: track?.status ?? null,
      nextAction: track?.nextAction ?? (isNextAction(app.next_action) ? app.next_action : null),
      event: {
        type: "application.campus_changed",
        summary: `Campus changed from ${fromCampus?.name ?? "unknown"} to ${to.name}${gradeId !== app.grade_id ? ` (${grade.name})` : ""}${parsed.reason ? ` — ${parsed.reason}` : ""}${track?.note ?? ""}`,
        payload: { from: fromCampus?.name ?? null, to: to.name, grade: grade.name, reason: parsed.reason ?? null, requires_assessment: requires },
      },
      audit: {
        action: "application.campus_changed",
        before: { campus_id: app.campus_id, grade_id: app.grade_id, requires_assessment: app.requires_assessment },
        after: { campus_id: parsed.campusId, grade_id: gradeId, requires_assessment: requires, reason: parsed.reason ?? null },
      },
      actor: ctx.actor,
    });
    if (play.reDraft) {
      await reissueLetter(admin, app, play, `Campus changed from ${fromCampus?.name ?? "unknown"} to ${to.name}`, ctx.actor);
      drainSoon();
      revalidatePath("/staff/offers");
    }
    done(app.id);
  });
}

/**
 * Delete an applicant outright.
 *
 * The system is append-only nearly everywhere on purpose, and for a family
 * that asks to be forgotten the right tool is the retention run, which
 * anonymises and keeps the funnel's counts honest. This is for the other
 * case: a record that should never have existed — a parent who submitted the
 * form twice, a training entry, a walk-in typed against the wrong family.
 * Those rows are noise, and until now the only way to remove one was hand
 * written SQL.
 *
 * Three gates, because the act cannot be undone: `applications.delete`, which
 * only the super administrator holds; the campus check every other action on
 * this page goes through; and the reference typed back by hand. The files go
 * first — a storage failure must stop the whole thing, and it cannot do that
 * from inside the database — then one function does the rest and leaves an
 * audit row naming what was destroyed.
 */
export async function deleteApplicant(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  // `redirect` throws and `guarded` would catch it, so the redirect happens
  // after the guard — there is no applicant page left to return to.
  let deleted = false;

  const state = await guarded(async () => {
    const ctx = await requireStaffAction("applications.delete");
    const parsed = idSchema
      .extend({
        confirm: z.string().trim().max(40),
        reason: z.string().trim().min(3, "Say why, in a few words.").max(300),
      })
      .parse(Object.fromEntries(formData));

    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    if (parsed.confirm.toUpperCase() !== app.reference.toUpperCase()) {
      throw new Error(`Type ${app.reference} to confirm. Nothing has been deleted.`);
    }

    await removeDocumentObjects(admin, app.id);

    const { error } = await admin.rpc("delete_application", {
      p_application_id: app.id,
      p_reason: parsed.reason,
      p_actor_id: ctx.userId,
      p_actor_label: ctx.actor.label ?? null,
    });
    if (error) throw new Error(error.message);

    deleted = true;
    done(app.id);
  });

  if (deleted) redirect("/staff/applications");
  return state;
}

/**
 * Correct a parent's mobile number.
 *
 * Numbers taken before the country and the number were asked for separately
 * can be anything a person typed, and a message to one of those fails
 * quietly. This is how a member of staff puts one right after reading it back
 * to the family: the same check the parent's own form runs, so what is stored
 * is a number WhatsApp will accept, and the change is audited under the name
 * of whoever made it.
 */
export async function updateParentMobile(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ mobile: mobileNumber }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    if (!app.contact_id) throw new Error("This application has no parent record to change.");

    const { data: before } = await admin.from("contacts").select("mobile, mobile_normalised").eq("id", app.contact_id).maybeSingle();
    if (before?.mobile_normalised === parsed.mobile) return;

    const { error } = await admin
      .from("contacts")
      .update({ mobile: parsed.mobile, mobile_normalised: parsed.mobile })
      .eq("id", app.contact_id);
    if (error) throw new Error(error.message);

    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: isNextAction(app.next_action) ? app.next_action : null,
      event: {
        type: "contact.mobile_changed",
        summary: "The parent's mobile number was corrected by staff",
        payload: {},
      },
      audit: {
        action: "contact.mobile_changed",
        before: { mobile: before?.mobile ?? null },
        after: { mobile: parsed.mobile },
      },
      actor: ctx.actor,
    });
    done(app.id);
  });
}

/**
 * The parent's name and email address, corrected by staff.
 *
 * A parent can change their own email from the booking page, but only while
 * they still have a working link — and the commonest reason to need a change
 * is that the address is wrong, so every link the school has sent has gone
 * nowhere. Somebody rings the office; this is what the office does about it.
 *
 * The name is here for the same reason and is far less fraught: nothing keys
 * off it, it just appears at the top of every letter and message.
 *
 * The address is the delicate half. `contacts.email_normalised` is unique, so
 * moving one onto an address another enquiry already holds is refused rather
 * than silently merging two families' records — the office joins those up by
 * hand, knowing which is which.
 */
export async function updateParentIdentity(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema
      .extend({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        email: z.email().max(254),
      })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    if (!app.contact_id) throw new Error("This application has no parent record to change.");

    const { data: before } = await admin
      .from("contacts")
      .select("first_name, last_name, email, email_normalised")
      .eq("id", app.contact_id)
      .maybeSingle();

    const normalised = normaliseEmail(parsed.email);
    const emailChanged = normalised !== before?.email_normalised;
    const nameChanged = before?.first_name !== parsed.firstName || before?.last_name !== parsed.lastName;
    // Saying "saved" for a form somebody opened and closed again would be a
    // lie, and it would put a meaningless entry on the family's timeline.
    if (!emailChanged && !nameChanged) return;

    if (emailChanged) {
      const { data: clash } = await admin
        .from("contacts")
        .select("id")
        .eq("email_normalised", normalised)
        .neq("id", app.contact_id)
        .maybeSingle();
      if (clash) {
        throw new Error(
          `${parsed.email} is already on another enquiry. Open that one and join the two by hand rather than pointing both at one address.`
        );
      }
    }

    const { error } = await admin
      .from("contacts")
      .update({
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        ...(emailChanged ? { email: parsed.email, email_normalised: normalised } : {}),
      })
      .eq("id", app.contact_id);
    // Another enquiry could have claimed the address between that check and
    // this write. The unique index is what actually decides.
    if (error) {
      throw new Error(
        error.code === "23505"
          ? `${parsed.email} was claimed by another enquiry a moment ago. Check that one first.`
          : error.message
      );
    }

    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: isNextAction(app.next_action) ? app.next_action : null,
      event: {
        type: "contact.identity_changed",
        // The old address goes on the timeline: when a family says they never
        // received anything, the thing worth seeing is where it was going.
        summary: emailChanged
          ? `The parent's details were corrected by staff — email was ${before?.email ?? "not set"}`
          : "The parent's name was corrected by staff",
        payload: {},
      },
      audit: {
        action: "contact.identity_changed",
        before: {
          first_name: before?.first_name ?? null,
          last_name: before?.last_name ?? null,
          email: before?.email ?? null,
        },
        after: { first_name: parsed.firstName, last_name: parsed.lastName, email: parsed.email },
      },
      actor: ctx.actor,
    });
    done(app.id);
  });
}

/**
 * The child's name and date of birth, corrected by staff.
 *
 * Enquiry forms are filled in on phones, in a hurry, often by somebody who
 * has typed their child's name into a dozen other forms that afternoon. The
 * surname lands in the first-name box; a name arrives in capitals; the year
 * of birth is last year's. Until now none of it could be put right: every
 * `Correct the…` control on this page edits the parent, and the child's name
 * was fixed at the moment of enquiry — while appearing at the top of every
 * letter, message and offer the school sends.
 *
 * The date of birth is the consequential half. The entry stage was worked out
 * from it when the enquiry came in, and is *not* recalculated here: by this
 * point the family may have been offered a place in a named stage, and
 * silently moving a child between stages because somebody fixed a typo is a
 * far worse failure than the typo. The form says so, and the stage is changed
 * deliberately or not at all.
 */
export async function updateChildDetails(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema
      .extend({
        childFirstName: z.string().trim().min(1).max(80),
        childLastName: z.string().trim().min(1).max(80),
        childDateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
          .refine((v) => isPlausibleDateOfBirth(v, toSchoolDateString(new Date())), {
            message: "Check the date of birth",
          }),
      })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);

    const firstName = tidyName(parsed.childFirstName);
    const lastName = tidyName(parsed.childLastName);
    const nameChanged = app.child_first_name !== firstName || app.child_last_name !== lastName;
    const dobChanged = app.child_date_of_birth !== parsed.childDateOfBirth;
    // A form somebody opened and closed again is not a correction.
    if (!nameChanged && !dobChanged) return;

    const { error } = await admin
      .from("applications")
      .update({
        child_first_name: firstName,
        child_last_name: lastName,
        child_date_of_birth: parsed.childDateOfBirth,
      })
      .eq("id", app.id);
    if (error) throw new Error(error.message);

    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: isNextAction(app.next_action) ? app.next_action : null,
      event: {
        type: "application.child_changed",
        // What it was goes on the timeline: a letter already sent carries the
        // old name, and somebody will have to reconcile the two.
        summary: dobChanged
          ? `The child's details were corrected by staff — was ${app.child_first_name} ${app.child_last_name}, born ${app.child_date_of_birth}`
          : `The child's name was corrected by staff — was ${app.child_first_name} ${app.child_last_name}`,
        payload: {},
      },
      audit: {
        action: "application.child_changed",
        before: {
          child_first_name: app.child_first_name,
          child_last_name: app.child_last_name,
          child_date_of_birth: app.child_date_of_birth,
        },
        after: { child_first_name: firstName, child_last_name: lastName, child_date_of_birth: parsed.childDateOfBirth },
      },
      actor: ctx.actor,
    });
    done(app.id);
  });
}

/**
 * The month a child starts, at a campus that takes children in by the month.
 *
 * Potch and Tlokweng families join in a month, not a term, and the letter
 * names it. The term is still recorded underneath — the fee schedule belongs
 * to an academic year and every report counts by term — so it follows the
 * month, worked out the same way the enquiry form works it out.
 *
 * Reversible to "not chosen", in which case the letter names the term again.
 * A letter already written is re-priced in the same step
 * (`onStartMonthChanged`); one the family has accepted keeps its month.
 */
export async function setStartMonth(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema
      .extend({ startMonth: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-01$/, "Choose a month")]) })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const to = parsed.startMonth === "" ? null : parsed.startMonth;
    if (to && !isMonthStart(to)) throw new Error("Choose a month.");
    const { reissued } = await onStartMonthChanged(admin, app, to, ctx.actor, { mayReprice: can(ctx.permissions, "offers.approve") });
    if (reissued) {
      drainSoon();
      revalidatePath("/staff/offers");
    }
    done(app.id);
  });
}

/**
 * Half day or full day, for a pre-school child.
 *
 * The school offers both and charges differently for each, so until somebody
 * says which, the offer letter shows both rates and asks the family to
 * confirm. Setting it here is what turns that choice into a single figure.
 *
 * Deliberately reversible to "not decided": a family that changes its mind
 * before accepting should not need a database edit, and an offer already sent
 * keeps the fees it froze either way.
 */
export async function setDayPattern(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema
      .extend({ dayPattern: z.enum(["half", "full", ""]) })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const to = parsed.dayPattern === "" ? null : parsed.dayPattern;
    if (app.day_pattern === to) return;

    const { error } = await admin.from("applications").update({ day_pattern: to }).eq("id", app.id);
    if (error) throw new Error(error.message);

    const say = (v: "half" | "full" | null) => (v === null ? "not decided" : v === "half" ? "half day" : "full day");
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: null,
      nextAction: isNextAction(app.next_action) ? app.next_action : null,
      event: {
        type: "application.day_pattern_set",
        summary: `Day pattern ${say(app.day_pattern)} → ${say(to)}`,
        payload: { from: app.day_pattern, to },
      },
      audit: { action: "application.day_pattern_set", entityType: "application", entityId: app.id },
      actor: ctx.actor,
    });
    revalidatePath(`/staff/applications/${app.id}`);
  });
}

/**
 * The scholarship band on one applicant: change it, award one, take it away.
 *
 * A scholarship is a promotion (see `lib/promotions/scholarship.ts`), so the
 * band is the promotion code and changing it is one upsert on
 * `application_promotions`. Doing it here rather than in the admin promotions
 * screen is the point: that screen edits what `SCHOLARSHIP-40` *means* for
 * everybody holding it, and a child awarded the wrong band needs the opposite
 * — their row moved, nobody else's.
 *
 * `offers.approve` rather than `applications.write`. The band decides what a
 * family pays for the next decade of their child's schooling, which is the
 * weight of signing off an offer, not of correcting a spelling.
 *
 * Choosing the band re-drafts the offer, on the school's instruction of
 * 14 October 2026: the percentage on the letter is the admissions officer's
 * to choose, and choosing it used to leave a warning that the letter still
 * said the old figure, and a second button to press. Now:
 *
 *   - a draft, or a letter waiting for approval, is re-drafted at the new band
 *     and waits for approval as before;
 *   - a letter already with the family is withdrawn (their link stops
 *     working) and re-drafted, and waits for approval: re-pricing a letter a
 *     parent has read without telling them would be worse than a new one;
 *   - once the family has accepted, the letter they accepted keeps its fees
 *     (that is `snapshotFees` working), and only the band on file changes.
 */
export async function setScholarship(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const parsed = idSchema
      .extend({ code: z.string().trim().max(40), reason: z.string().trim().max(500).optional() })
      .parse(Object.fromEntries(formData));
    // "keep" is the screen's way of saying "I opened this box and changed
    // nothing". A child holding an ordinary deal has no band selected, so
    // without it a stray Save would read as "remove the deal" and take one
    // away that nobody meant to touch.
    if (parsed.code === "keep") return;
    const to = parsed.code === "" ? null : parsed.code;
    // A staff discount is chosen here too, beside the bands (20 October 2026):
    // it is the same one deal per child, re-priced the same way.
    if (to !== null && !isScholarshipCode(to) && !isStaffDiscountCode(to)) throw new Error("That is not a scholarship band or a discount.");

    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    const held = await promotionOn(admin, app.id);
    const from = held?.promo.code ?? null;
    // "Scholarship 10% → 20%" as before; a change that involves a discount
    // says what each side was, since "Scholarship 10% → 5% off tuition" is not.
    const deal = isStaffDiscountCode(from) || isStaffDiscountCode(to);
    const what = deal ? "Discount or scholarship" : "Scholarship";
    const say = (code: string | null) =>
      discountLabelOf(code) ?? (awardLabelOf(code) ? `${awardLabelOf(code)}${deal ? " scholarship" : ""}` : null) ?? code ?? (deal ? "none" : "no scholarship");

    // The letter in play, and whether saving re-prices it: one waiting for
    // approval is re-drafted, one with the family is withdrawn and re-drafted.
    // A draft resting on `offer_draft` is one waiting for fees: drafting it
    // again would only raise a second "configure fees" task, and it takes the
    // band when Generate offer is pressed. The same rule as the starting
    // month and the campus (`lib/workflow/reprice-actions.ts`).
    const play = await letterInPlay(admin, app);
    const { letter, withFamily, reDraft } = play;

    // The band on file already: nothing to record, but a letter still priced
    // under another deal — a band changed before saving re-drafted — is
    // brought into line, which is what the screen's warning offers.
    if (from === to && (!reDraft || letter?.promotion_id === (held?.promo.id ?? null))) return;

    // Before anything changes: the family's letter is withdrawn only when a
    // new one can be priced. Otherwise their link would stop working with
    // nothing to replace it.
    if (withFamily) {
      const graph = await loadApplicationGraph(admin, app.id);
      if (!graph) throw new Error("That applicant no longer exists.");
      await requirePriceable(admin, { campusId: graph.application.campus_id, academicYearId: graph.intake.academic_year_id, gradeSort: graph.grade.sort_order });
    }

    if (from !== to) {
      if (to === null) {
        await clearPromotion(admin, app.id);
      } else {
        const { data: promo, error } = await admin.from("promotions").select("id, is_active").eq("code", to).maybeSingle();
        if (error) throw new Error(error.message);
        if (!promo) throw new Error(`There is no ${to} promotion set up to award.`);
        if (!promo.is_active) throw new Error(`${to} is switched off. Switch it back on in Promotions before awarding it.`);
        await recordPromotion(admin, app.id, promo.id, "staff", {
          staffId: ctx.userId,
          reason: parsed.reason || "Band set on the applicant page",
        });
      }
      await commit(admin, {
        applicationId: app.id,
        expectedStatus: app.status,
        newStatus: null,
        nextAction: isNextAction(app.next_action) ? app.next_action : null,
        event: {
          type: "scholarship.changed",
          summary: `${what} ${say(from)} → ${say(to)}`,
          payload: { from, to, reason: parsed.reason ?? null },
        },
        audit: { action: "scholarship.changed", entityType: "application", entityId: app.id },
        actor: ctx.actor,
      });
    }

    if (reDraft) {
      // Withdraws the family's letter when they have it, then drafts the next
      // one for approval, whatever `offer_auto_approve` says: the screen
      // promises the officer a letter to check before it goes. The old
      // letter's conditions carry over, which re-drafting here used to drop
      // for a letter the family already had.
      await reissueLetter(admin, app, play, from === to ? `Re-priced at ${say(to)}` : `${what} changed from ${say(from)} to ${say(to)}`, ctx.actor);
      drainSoon();
    }
    done(app.id);
    revalidatePath("/staff/offers");
  });
}
