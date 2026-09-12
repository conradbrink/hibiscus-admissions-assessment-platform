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
import { generateSummary } from "@/lib/summary/generate";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { getSettings } from "@/lib/settings";
import { mintToken } from "@/lib/tokens";
import { mobileNumber } from "@/lib/validation";
import {
  onBookingCancelled,
  onBookingCreated,
  onCallbackCompleted,
  onCheckedIn,
  onDeferralEnded,
  onDeferred,
  onManualDecision,
  onNoShow,
  onOwnerAssigned,
  onRescheduled,
  onWithdrawn,
} from "@/lib/workflow/actions";
import { commit } from "@/lib/workflow/engine";
import { isFutureDate } from "@/lib/workflow/deferral";
import { isNextAction } from "@/lib/workflow/states";
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
    if (booking) {
      await onRescheduled(admin, app, booking, parsed.sessionId, ctx.actor);
    } else {
      const { data: bookingId, error } = await admin.rpc("book_session", {
        p_application_id: app.id,
        p_session_id: parsed.sessionId,
      });
      if (error) throw new Error(error.message);
      const { data: session } = await admin.from("sessions").select("id, kind, starts_at").eq("id", parsed.sessionId).single();
      if (!session) throw new Error("Session not found");
      await onBookingCreated(admin, app, { id: bookingId, kind: session.kind }, session, ctx.actor);
    }
    drainSoon();
    done(parsed.applicationId);
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
 * back or close their application, while approving, waitlisting and declining
 * still need decisions.override.
 */
export async function recordDecision(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const raw = Object.fromEntries(formData);
    const outcome = z.enum(["approved", "waitlisted", "declined", "deferred", "withdrawn"]).parse(raw.outcome);
    const paused = outcome === "deferred" || outcome === "withdrawn";
    const ctx = await requireStaffAction(paused ? "applications.write" : "decisions.override");

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
        })
        .parse(raw);
      // A date in the past is a typo, and the follow-ups for it would all be
      // dropped as already gone — leaving a paused application nothing would
      // ever wake.
      if (!isFutureDate(parsed.until)) throw new Error("Choose a date in the future.");
      const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
      await onDeferred(admin, app, { until: parsed.until, reason: parsed.reason?.trim() || null }, ctx.actor);
      done(parsed.applicationId);
      return;
    }

    const parsed = idSchema
      .extend({ reason: z.string().trim().min(5, "Give a reason of at least a few words.").max(1000) })
      .parse(raw);
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    await onManualDecision(admin, app, outcome, parsed.reason, ctx.actor);
    // An approval queues the offer draft; run it now rather than on the
    // next sweep, so the child is on the Offers page when staff look.
    drainSoon();
    done(parsed.applicationId);
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

    const { error } = await admin.from("applications").update({ grade_id: parsed.gradeId }).eq("id", app.id);
    if (error) throw new Error(error.message);

    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: null,
      // The stage changes; where the application is in the pipeline does not.
      // `next_action` is a plain string on the row and the engine wants its
      // own union, so it is narrowed through the shared guard.
      nextAction: isNextAction(app.next_action) ? app.next_action : null,
      event: {
        type: "application.grade_changed",
        summary: `Stage changed from ${from?.name ?? "unknown"} to ${to.name}${parsed.reason ? ` — ${parsed.reason}` : ""}`,
        payload: { from: from?.name ?? null, to: to.name, reason: parsed.reason ?? null },
      },
      audit: {
        action: "application.grade_changed",
        before: { grade: from?.name ?? null },
        after: { grade: to.name, reason: parsed.reason ?? null },
      },
      actor: ctx.actor,
    });
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
