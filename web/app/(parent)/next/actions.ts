"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { loadCatalogue } from "@/lib/enquiry";
import { funnelSessionKey } from "@/lib/funnel-session";
import { recordFunnelStep } from "@/lib/funnel";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { withinCutoff } from "@/lib/format-date";
import { requireParentSession } from "@/lib/tokens/server";
import { commit, PARENT_ACTOR } from "@/lib/workflow/engine";
import {
  onBookingCancelled,
  onBookingCreated,
  onEnquiryCreated,
  onRescheduled,
} from "@/lib/workflow/actions";
import { drainJobs } from "@/lib/workflow/jobs";

/**
 * Everything a parent can do from their session. Each action re-reads the
 * session, scopes every query to that one application id, and never trusts
 * an id from the form.
 */

export type ActionState = { error?: string };

function drainSoon() {
  after(async () => {
    await drainJobs(createAdminClient()).catch((e) => console.error("[jobs] drain failed", e));
  });
}

const confirmGradeSchema = z.object({
  gradeId: z.guid(),
  campusId: z.guid(),
  intakeId: z.guid(),
  t0: z.coerce.number().int().nonnegative().optional(),
});

/**
 * Step 2. The parent confirms (or changes) grade, campus and start term.
 * Then, and only then, the application is routed: emails queued, tasks
 * opened, status set. A parent who abandons before this point has an
 * unrouted enquiry, which the job drain's sweep picks up after ten minutes.
 */
export async function confirmGrade(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireParentSession();
  const parsed = confirmGradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please choose a grade, campus and start term." };

  const admin = createAdminClient();
  const catalogue = await loadCatalogue(admin);
  const { gradeId, campusId, intakeId } = parsed.data;
  if (!(catalogue.offered[campusId] ?? []).includes(gradeId)) {
    return { error: "That campus does not offer that grade. Please choose another." };
  }
  if (!catalogue.intakes.some((i) => i.id === intakeId)) {
    return { error: "Please choose an open start term." };
  }

  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const app = graph.application;

  // Only an unrouted enquiry can still change these here. Later, a parent
  // asks staff — the assessment paper and the offer both depend on them.
  const unrouted = app.status === "new_enquiry" && app.next_action === null;
  if (!unrouted) redirect("/next");

  // Whether an assessment applies follows the class *at this campus*, and the
  // parent may have moved either since the enquiry. Recomputing it here is
  // what keeps a child who switched from Nursery to Stage 1 from skipping the
  // assessment, and a Reception child at a pre-school from being sent to one.
  const requiresAssessment = catalogue.assessed[campusId]?.[gradeId] ?? app.requires_assessment;

  const { error } = await admin
    .from("applications")
    .update({ grade_id: gradeId, campus_id: campusId, intake_id: intakeId, requires_assessment: requiresAssessment })
    .eq("id", app.id)
    .eq("status", "new_enquiry");
  if (error) return { error: "Could not save your choice. Please try again." };

  const { data: fresh } = await admin
    .from("applications")
    .select("id, reference, status, entry_route, requires_assessment, child_first_name")
    .eq("id", app.id)
    .single();
  if (!fresh) redirect("/link?reason=unknown");

  const ctx = await requestContext();
  await onEnquiryCreated(admin, fresh, `${graph.contact.first_name} ${graph.contact.last_name}`, {
    ...PARENT_ACTOR,
    ipHash: ctx.ipHash,
  });

  await recordFunnelStep(admin, {
    sessionKey: await funnelSessionKey(),
    step: "grade.confirmed",
    applicationId: app.id,
    campusId,
    gradeId,
    elapsedMs: parsed.data.t0 ? Math.max(0, Date.now() - parsed.data.t0) : null,
  });
  drainSoon();

  // Everyone chooses a time next: an assessment for Reception to Form 5, a
  // campus visit for younger children (the booking page offers only visits
  // to them) and for anyone who came through the visit door.
  redirect("/next/book");
}

const bookSchema = z.object({
  sessionId: z.guid(),
  t0: z.coerce.number().int().nonnegative().optional(),
});

/** Step 3. The parent taps a time. */
export async function bookSlot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireParentSession();
  const parsed = bookSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please choose a time." };

  const admin = createAdminClient();
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.parentBooking, session.applicationId);
  if (!verdict.ok) return { error: "Too many changes in a short time. Please try again shortly." };

  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const app = graph.application;
  const actor = { ...PARENT_ACTOR, ipHash: ctx.ipHash };

  const { data: target, error: sErr } = await admin
    .from("sessions")
    .select("id, kind, starts_at, campus_id")
    .eq("id", parsed.data.sessionId)
    .eq("is_published", true)
    .maybeSingle();
  if (sErr || !target) return { error: "That time is no longer available. Please choose another." };
  if (target.campus_id !== app.campus_id) {
    return { error: "That time is at a different campus. Please choose another." };
  }

  // A parent has one appointment at a time, whichever kind it is. Treating a
  // move from an assessment to a visit as a fresh booking left the old one
  // live, and the new one then collided with it.
  if (graph.booking) {
    const settings = await getSettings(admin);
    if (withinCutoff(graph.booking.session.starts_at, settings.rescheduleCutoffHours)) {
      const noun = graph.booking.kind === "assessment" ? "assessment" : "visit";
      return { error: `Bookings cannot be changed online within ${settings.rescheduleCutoffHours} hours of the ${noun}. Please call ${graph.campus.name}.` };
    }
  }

  try {
    if (graph.booking) {
      await onRescheduled(admin, app, graph.booking, target.id, actor);
    } else {
      const { data: bookingId, error } = await admin.rpc("book_session", {
        p_application_id: app.id,
        p_session_id: target.id,
      });
      if (error) throw error;
      try {
        await onBookingCreated(admin, app, { id: bookingId, kind: target.kind }, target, actor);
      } catch (e) {
        // `book_session` has already committed the row; recording the moment
        // is a second call. If that fails there is no transaction to roll
        // back, so undo the booking by hand — otherwise the parent is told
        // the booking failed and holds one anyway, and their next attempt
        // hits `already_booked`.
        await admin
          .from("bookings")
          .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancel_reason: "The booking could not be recorded",
          })
          .eq("id", bookingId)
          .eq("status", "booked");
        throw e;
      }
    }
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("session_full")) return { error: "That time has just filled up. Please choose another." };
    if (msg.includes("session_in_past") || msg.includes("session_unavailable")) {
      return { error: "That time is no longer available. Please choose another." };
    }
    if (msg.includes("grade_not_in_range")) {
      return { error: "That session is for a different age group. Please choose another." };
    }
    // Both of these reached the parent as "could not make the booking", which
    // says nothing and invites a retry that fails the same way.
    if (msg.includes("already_booked")) {
      return { error: "You already have a booking. Open it from your application to change the time." };
    }
    if (msg.includes("application_not_found")) {
      return { error: "We could not find the grade on your application. Please confirm it first." };
    }
    console.error("[booking] failed", msg);
    return { error: "Could not make the booking. Please try again." };
  }

  await recordFunnelStep(admin, {
    sessionKey: await funnelSessionKey(),
    step: target.kind === "visit" ? "visit.booked" : "booking.confirmed",
    applicationId: app.id,
    campusId: app.campus_id,
    gradeId: app.grade_id,
    elapsedMs: parsed.data.t0 ? Math.max(0, Date.now() - parsed.data.t0) : null,
  });
  drainSoon();
  redirect("/next/booked");
}

/** Cancels the live booking. The parent can book again from the hub. */
export async function cancelBooking(): Promise<void> {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const ctx = await requestContext();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph?.booking) redirect("/next");
  const settings = await getSettings(admin);
  if (withinCutoff(graph.booking.session.starts_at, settings.rescheduleCutoffHours)) redirect("/next/booking?cutoff=1");
  await onBookingCancelled(admin, graph.application, graph.booking, "Cancelled by parent", {
    ...PARENT_ACTOR,
    ipHash: ctx.ipHash,
  });
  drainSoon();
  redirect("/next");
}

/**
 * WhatsApp updates on or off, for the contact on this application. The
 * choice is the contact's, so it applies to every child they have applied
 * for; the audit trail records it on this application.
 */
export async function setWhatsAppPreference(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const ctx = await requestContext();
  const optIn = formData.get("optIn") === "1";
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const { error } = await admin
    .from("contacts")
    .update(
      optIn
        ? { whatsapp_opt_in: true, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_in_source: "enquiry", whatsapp_opt_out_at: null }
        : { whatsapp_opt_in: false, whatsapp_opt_out_at: new Date().toISOString() }
    )
    .eq("id", graph.contact.id);
  if (error) return { error: "Could not save that. Please try again." };
  await commit(admin, {
    applicationId: graph.application.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: optIn ? "messaging.opted_in" : "messaging.opted_out", summary: optIn ? "Parent turned WhatsApp updates on" : "Parent turned WhatsApp updates off" },
    audit: { action: optIn ? "contact.whatsapp_opt_in" : "contact.whatsapp_opt_out", entityType: "contact", entityId: graph.contact.id },
    actor: { ...PARENT_ACTOR, ipHash: ctx.ipHash },
  });
  revalidatePath("/next");
  return {};
}
