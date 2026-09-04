import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, BookingRow, SessionRow } from "@/lib/supabase/types";
import { getSettings } from "@/lib/settings";
import { formatDateLong, formatTime } from "@/lib/format-date";
import { onStaffDecision } from "@/lib/workflow/decision-actions";
import {
  commit,
  hoursBefore,
  hoursFromNow,
  WorkflowError,
  type Actor,
  type JobSpec,
} from "@/lib/workflow/engine";

/**
 * The named things that can happen to an application.
 *
 * Each function is one entry in the event → actions map from the design
 * document, expressed as a single atomic {@link commit}. Read them as a table:
 * what status, what next action, which emails, which tasks, which reminders.
 *
 * Emails are never sent from here. They are queued as `send_email` jobs with
 * a precondition, so a reminder for a booking that was since cancelled is
 * skipped at send time rather than sent. The drain runs immediately after the
 * request via `after()`, so the common case is still fast.
 */

const emailJob = (
  applicationId: string,
  templateKey: string,
  opts: {
    suffix?: string;
    runAfter?: Date;
    precondition?: JobSpec["precondition"];
    bookingId?: string;
  } = {}
): JobSpec => ({
  type: "send_email",
  payload: { template_key: templateKey, booking_id: opts.bookingId },
  // One email of a given kind per application (or per booking, for
  // reminders). A retried transition cannot queue it twice.
  idempotencyKey: `email:${applicationId}:${templateKey}${opts.suffix ? ":" + opts.suffix : ""}`,
  runAfter: opts.runAfter,
  precondition: opts.precondition,
});

// ---------------------------------------------------------------------------
// Enquiry
// ---------------------------------------------------------------------------

/**
 * The first transition. Which of the three doors the parent came through and
 * whether their child's grade needs an assessment decide everything.
 */
export async function onEnquiryCreated(
  admin: AdminClient,
  app: Pick<
    ApplicationRow,
    "id" | "reference" | "status" | "entry_route" | "requires_assessment" | "child_first_name"
  >,
  parentName: string,
  actor: Actor
): Promise<void> {
  const settings = await getSettings(admin);

  if (app.entry_route === "callback") {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: "new_enquiry",
      newStatus: "callback_requested",
      nextAction: "await_callback",
      nextActionDueAt: hoursFromNow(24),
      event: {
        type: "enquiry.created",
        summary: `Enquiry received — ${parentName} asked for a call`,
        payload: { entry_route: app.entry_route },
      },
      tasks: [
        {
          type: "callback",
          title: `Call ${parentName} about ${app.child_first_name}`,
          details: "The parent asked to be called rather than booking online.",
          priority: "high",
          dueAt: hoursFromNow(24),
        },
      ],
      jobs: [emailJob(app.id, "callback_received")],
      audit: { action: "application.created", after: { reference: app.reference } },
      actor,
    });
    return;
  }

  if (!app.requires_assessment) {
    // Pre-school. There is no assessment to book; the school reviews
    // availability. In Phase 1 that is a task; later phases automate it
    // against intake capacity.
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: "new_enquiry",
      newStatus: "awaiting_decision",
      nextAction: "await_school_contact",
      nextActionDueAt: hoursFromNow(48),
      event: {
        type: "enquiry.created",
        summary: `Enquiry received — pre-school, no assessment required`,
        payload: { entry_route: app.entry_route },
      },
      tasks: [
        {
          type: "review_preschool_enquiry",
          title: `Review pre-school enquiry for ${app.child_first_name}`,
          details: "Confirm availability and record a decision.",
          priority: "normal",
          dueAt: hoursFromNow(48),
        },
      ],
      jobs: [emailJob(app.id, "preschool_enquiry_received")],
      audit: { action: "application.created", after: { reference: app.reference } },
      actor,
    });
    return;
  }

  // Assessment track, arriving via the assessment door or the visit door.
  // The funnel books a slot in the same sitting, so the "enquiry received"
  // email is delayed a few minutes and skipped if a booking lands first —
  // the parent then gets "booking confirmed" instead of two emails.
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: "new_enquiry",
    newStatus: "new_enquiry",
    nextAction: "book_assessment",
    nextActionDueAt: hoursFromNow(settings.enquiryNudgeHours),
    event: {
      type: "enquiry.created",
      summary: "Enquiry received",
      payload: { entry_route: app.entry_route },
    },
    jobs: [
      emailJob(app.id, "enquiry_received", {
        runAfter: new Date(Date.now() + 10 * 60_000),
        precondition: { application_status: ["new_enquiry"] },
      }),
      emailJob(app.id, "enquiry_nudge", {
        runAfter: hoursFromNow(settings.enquiryNudgeHours),
        precondition: { application_status: ["new_enquiry"] },
      }),
    ],
    audit: { action: "application.created", after: { reference: app.reference } },
    actor,
  });
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

function bookingSummary(session: Pick<SessionRow, "starts_at">, kind: "assessment" | "visit") {
  return `${kind === "assessment" ? "Assessment" : "Visit"} booked for ${formatDateLong(session.starts_at)}, ${formatTime(session.starts_at)}`;
}

/**
 * After `book_session()` has inserted the booking row. Confirms, explains,
 * and schedules the reminders — each conditional on the booking still being
 * live when its time comes.
 */
export async function onBookingCreated(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  booking: Pick<BookingRow, "id" | "kind">,
  session: Pick<SessionRow, "starts_at">,
  actor: Actor,
  opts: { rescheduledFromId?: string } = {}
): Promise<void> {
  const settings = await getSettings(admin);
  const startsAt = new Date(session.starts_at);
  const live = { booking_id: booking.id, booking_status: ["booked"] };

  if (booking.kind === "visit") {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: "visit_booked",
      nextAction: "attend_visit",
      nextActionDueAt: startsAt,
      event: {
        type: "booking.created",
        summary: bookingSummary(session, "visit"),
        payload: { booking_id: booking.id, kind: "visit" },
      },
      resolveTaskTypes: ["callback"],
      jobs: [emailJob(app.id, "visit_confirmed", { suffix: booking.id, bookingId: booking.id })],
      audit: { action: "booking.created", entityType: "booking", entityId: booking.id },
      actor,
    });
    return;
  }

  const jobs: JobSpec[] = [
    emailJob(app.id, "booking_confirmed", { suffix: booking.id, bookingId: booking.id }),
    emailJob(app.id, "what_to_expect", {
      suffix: booking.id,
      bookingId: booking.id,
      runAfter: hoursFromNow(1),
      precondition: live,
    }),
  ];
  const reminderKeys: Record<number, string> = {};
  const sorted = [...settings.assessmentReminderHours].sort((a, b) => b - a);
  sorted.forEach((hours, i) => {
    // The largest offset is the "48 hour" template, everything closer is the
    // "day of" template. Configurable offsets, fixed wording.
    reminderKeys[hours] = i === 0 ? "assessment_reminder_48h" : "assessment_reminder_day";
  });
  for (const hours of sorted) {
    const at = hoursBefore(startsAt, hours);
    // A booking made inside the reminder window would otherwise fire the
    // reminder immediately, on top of the confirmation.
    if (at.getTime() <= Date.now() + 15 * 60_000) continue;
    jobs.push(
      emailJob(app.id, reminderKeys[hours], {
        suffix: `${booking.id}:${hours}h`,
        bookingId: booking.id,
        runAfter: at,
        precondition: live,
      })
    );
  }

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "assessment_booked",
    nextAction: "attend_assessment",
    nextActionDueAt: startsAt,
    event: {
      type: opts.rescheduledFromId ? "booking.rescheduled" : "booking.created",
      summary: opts.rescheduledFromId
        ? `Assessment moved to ${formatDateLong(session.starts_at)}, ${formatTime(session.starts_at)}`
        : bookingSummary(session, "assessment"),
      payload: {
        booking_id: booking.id,
        kind: "assessment",
        rescheduled_from: opts.rescheduledFromId,
      },
    },
    resolveTaskTypes: ["callback", "follow_up_no_show"],
    jobs,
    audit: { action: "booking.created", entityType: "booking", entityId: booking.id },
    actor,
  });
}

/** Staff taps Check in. The booking moves; the application does not. */
export async function onCheckedIn(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  booking: Pick<BookingRow, "id" | "kind" | "status">,
  actor: Actor
): Promise<void> {
  if (booking.status !== "booked") {
    throw new WorkflowError(`Booking is ${booking.status}, not booked`, "status_conflict");
  }
  const { error } = await admin
    .from("bookings")
    .update({
      status: "checked_in",
      checked_in_at: new Date().toISOString(),
      checked_in_by: actor.type === "staff" ? (actor.id ?? null) : null,
    })
    .eq("id", booking.id)
    .eq("status", "booked");
  if (error) throw new WorkflowError(error.message, "database");

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: null,
    nextAction: null,
    event: {
      type: "booking.checked_in",
      summary: booking.kind === "assessment" ? "Arrived for assessment" : "Arrived for visit",
      payload: { booking_id: booking.id },
    },
    audit: { action: "booking.checked_in", entityType: "booking", entityId: booking.id },
    actor,
  });
}

/** Staff marks a no-show. Opens a follow-up and invites the parent to rebook. */
export async function onNoShow(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  booking: Pick<BookingRow, "id" | "kind" | "status">,
  actor: Actor
): Promise<void> {
  const { error } = await admin
    .from("bookings")
    .update({ status: "no_show" })
    .eq("id", booking.id)
    .in("status", ["booked", "checked_in"]);
  if (error) throw new WorkflowError(error.message, "database");

  if (booking.kind === "visit") {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: "new_enquiry",
      nextAction: "book_assessment",
      event: { type: "booking.no_show", summary: "Did not attend visit", payload: { booking_id: booking.id } },
      audit: { action: "booking.no_show", entityType: "booking", entityId: booking.id },
      actor,
    });
    return;
  }

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "no_show",
    nextAction: "rebook_assessment",
    nextActionDueAt: hoursFromNow(72),
    event: {
      type: "booking.no_show",
      summary: "Did not attend assessment",
      payload: { booking_id: booking.id },
    },
    tasks: [
      {
        type: "follow_up_no_show",
        title: `Follow up missed assessment — ${app.child_first_name}`,
        details: "The parent has been emailed a rebooking link. Call if there is no booking within a few days.",
        priority: "normal",
        dueAt: hoursFromNow(72),
      },
    ],
    jobs: [emailJob(app.id, "no_show_reschedule", { suffix: booking.id, bookingId: booking.id })],
    audit: { action: "booking.no_show", entityType: "booking", entityId: booking.id },
    actor,
  });
}

/** Parent or staff cancels a live booking without picking a new one. */
export async function onBookingCancelled(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  booking: Pick<BookingRow, "id" | "kind">,
  reason: string | null,
  actor: Actor
): Promise<void> {
  const { error } = await admin
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq("id", booking.id)
    .in("status", ["booked", "checked_in"]);
  if (error) throw new WorkflowError(error.message, "database");

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "new_enquiry",
    nextAction: "book_assessment",
    nextActionDueAt: hoursFromNow(48),
    event: {
      type: "booking.cancelled",
      summary: `${booking.kind === "assessment" ? "Assessment" : "Visit"} booking cancelled`,
      payload: { booking_id: booking.id, reason },
    },
    audit: { action: "booking.cancelled", entityType: "booking", entityId: booking.id },
    actor,
  });
}

/**
 * Moves a booking. The old row becomes `rescheduled` pointing at the new one,
 * so its reminders fail their precondition and are skipped; the new booking
 * gets its own confirmation and reminders.
 */
export async function onRescheduled(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  oldBooking: Pick<BookingRow, "id">,
  newSessionId: string,
  actor: Actor
): Promise<string> {
  // Free the seat first so a parent moving to another slot on the same
  // session's day does not hit its own unique index.
  const { error: relErr } = await admin
    .from("bookings")
    .update({ status: "rescheduled" })
    .eq("id", oldBooking.id)
    .in("status", ["booked", "checked_in"]);
  if (relErr) throw new WorkflowError(relErr.message, "database");

  const { data: newId, error } = await admin.rpc("book_session", {
    p_application_id: app.id,
    p_session_id: newSessionId,
  });
  if (error) {
    // Put the old booking back; nothing else has changed yet.
    await admin.from("bookings").update({ status: "booked" }).eq("id", oldBooking.id);
    throw new WorkflowError(error.message, "database");
  }
  await admin.from("bookings").update({ rescheduled_to_id: newId }).eq("id", oldBooking.id);

  const { data: session, error: sErr } = await admin
    .from("sessions")
    .select("id, starts_at, kind")
    .eq("id", newSessionId)
    .single();
  if (sErr || !session) throw new WorkflowError(sErr?.message ?? "session missing", "database");

  await onBookingCreated(
    admin,
    app,
    { id: newId, kind: session.kind },
    session,
    actor,
    { rescheduledFromId: oldBooking.id }
  );
  return newId;
}

// ---------------------------------------------------------------------------
// Staff decisions (Phase 1: the assessment-exempt track, and overrides)
// ---------------------------------------------------------------------------

export type ManualOutcome = "approved" | "waitlisted" | "declined";

/**
 * A member of staff records an outcome by hand: a pre-school enquiry, a
 * referral from the rules engine, or an override. All three write the same
 * decision row and the same follow-ups as a rules decision — see
 * decision-actions.ts, which owns that.
 */
export async function onManualDecision(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  outcome: ManualOutcome,
  reason: string,
  actor: Actor
): Promise<void> {
  await onStaffDecision(admin, app, outcome, reason, actor);
}

/**
 * Withdraws from any non-terminal state. Cancels the live booking, abandons
 * a live sitting, withdraws a live offer, and closes open tasks — so no job
 * queued for any of them finds its precondition still true.
 */
export async function onWithdrawn(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  reason: string | null,
  actor: Actor
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: now, cancel_reason: "Application withdrawn" })
    .eq("application_id", app.id)
    .in("status", ["booked", "checked_in", "in_progress"]);
  await admin
    .from("attempts")
    .update({ status: "abandoned" })
    .eq("application_id", app.id)
    .in("status", ["ready", "in_progress"]);
  await admin
    .from("offers")
    .update({ status: "withdrawn", withdrawn_reason: "Application withdrawn" })
    .eq("application_id", app.id)
    .in("status", ["draft", "pending_approval", "sent", "viewed"]);
  await admin
    .from("tasks")
    .update({ status: "cancelled", resolved_at: now, resolution_note: "Application withdrawn" })
    .eq("application_id", app.id)
    .eq("status", "open");
  const { error } = await admin
    .from("applications")
    .update({ withdrawn_reason: reason })
    .eq("id", app.id);
  if (error) throw new WorkflowError(error.message, "database");

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "withdrawn",
    nextAction: "none",
    event: { type: "application.withdrawn", summary: "Application withdrawn", payload: { reason } },
    audit: { action: "application.withdrawn", before: { status: app.status }, after: { reason } },
    actor,
  });
}

/** Staff completes a callback: the parent is back on the booking track. */
export async function onCallbackCompleted(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "requires_assessment">,
  note: string | null,
  actor: Actor
): Promise<void> {
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: app.requires_assessment ? "new_enquiry" : "awaiting_decision",
    nextAction: app.requires_assessment ? "book_assessment" : "await_school_contact",
    nextActionDueAt: hoursFromNow(48),
    event: { type: "callback.completed", summary: "Parent called", payload: { note } },
    resolveTaskTypes: ["callback"],
    audit: { action: "callback.completed", after: { note } },
    actor,
  });
}

/** Ownership is not a pipeline move, but it is a timeline entry. */
export async function onOwnerAssigned(
  admin: AdminClient,
  applicationId: string,
  ownerStaffId: string | null,
  ownerName: string | null,
  actor: Actor
): Promise<void> {
  const { error } = await admin
    .from("applications")
    .update({ owner_staff_id: ownerStaffId })
    .eq("id", applicationId);
  if (error) throw new WorkflowError(error.message, "database");
  await commit(admin, {
    applicationId,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: {
      type: "owner.assigned",
      summary: ownerName ? `Assigned to ${ownerName}` : "Owner cleared",
      payload: { owner_staff_id: ownerStaffId },
    },
    audit: { action: "owner.assigned", after: { owner_staff_id: ownerStaffId } },
    actor,
  });
}
