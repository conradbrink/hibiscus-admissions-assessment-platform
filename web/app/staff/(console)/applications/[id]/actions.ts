"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCompanionMessage } from "@/lib/messaging/send";
import { generateSummary } from "@/lib/summary/generate";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { getSettings } from "@/lib/settings";
import { mintToken } from "@/lib/tokens";
import {
  onBookingCancelled,
  onBookingCreated,
  onCallbackCompleted,
  onCheckedIn,
  onManualDecision,
  onNoShow,
  onOwnerAssigned,
  onRescheduled,
  onWithdrawn,
} from "@/lib/workflow/actions";
import { commit } from "@/lib/workflow/engine";

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

const idSchema = z.object({ applicationId: z.uuid() });

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
    const parsed = idSchema.extend({ sessionId: z.uuid() }).parse(Object.fromEntries(formData));
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

export async function recordDecision(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
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

export async function withdraw(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = idSchema.extend({ reason: z.string().trim().min(3).max(500) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, parsed.applicationId);
    await onWithdrawn(admin, app, parsed.reason, ctx.actor);
    done(parsed.applicationId);
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

export async function completeTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = z.object({ taskId: z.uuid(), note: z.string().trim().max(500).optional(), applicationId: z.uuid().optional() }).parse(Object.fromEntries(formData));
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
    const parsed = z.object({ taskId: z.uuid(), assigneeStaffId: z.string(), applicationId: z.uuid().optional() }).parse(Object.fromEntries(formData));
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
