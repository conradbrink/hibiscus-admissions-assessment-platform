import type { ApplicationStatus, BookingStatus } from "@/lib/supabase/types";
import { canTransition, statusAfterCancellation, TERMINAL_STATUSES } from "@/lib/workflow/states";

/**
 * A booking as an appointment: the one line staff read about it.
 *
 * A booking ends one of two ways and never both:
 *
 *   booked → arrived → in progress → completed
 *   booked → no-show
 *
 * The bookings table keeps a few more words (`cancelled`, `rescheduled`)
 * which are not ends of an appointment but its removal, and they read as
 * such. Pure, like `states.ts`, so the engine, the applicant page and
 * Today's assessments all ask the same question and get the same answer.
 *
 * Why it exists: `onNoShow` accepted a booking that was already checked in,
 * and both screens offered No-show beside a child who had arrived. The
 * applicant read "Arrived" on the timeline and "No-show" on the badge, the
 * funnel counted the child as attended and as missed, and the parent was
 * emailed a rebooking link for an assessment they had come to. The database
 * refuses it too now (`bookings_guard_no_show`).
 */
export type AppointmentState = "booked" | "arrived" | "in_progress" | "completed" | "no_show" | "cancelled" | "moved";

export const APPOINTMENT_STATE: Record<BookingStatus, AppointmentState> = {
  booked: "booked",
  checked_in: "arrived",
  in_progress: "in_progress",
  completed: "completed",
  no_show: "no_show",
  cancelled: "cancelled",
  rescheduled: "moved",
};

export const APPOINTMENT_LABELS: Record<AppointmentState, string> = {
  booked: "Booked",
  arrived: "Arrived",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
  moved: "Moved",
};

/** The steps of an appointment that went ahead, in order, for the little tracker. */
export const APPOINTMENT_STEPS: readonly AppointmentState[] = ["booked", "arrived", "in_progress", "completed"];

/**
 * Whether this child can be checked in now. Only a booking nobody has
 * arrived for, and never on an application that is closed: a declined
 * family keeps their booking until the letter goes (`onOutcomeSent`), and
 * checking them in would have them arrive for a place already refused.
 */
export function canCheckIn(bookingStatus: BookingStatus, appStatus: ApplicationStatus): boolean {
  return bookingStatus === "booked" && !TERMINAL_STATUSES.has(appStatus);
}

/**
 * Where marking a booking as a no-show leaves the application, or why it
 * cannot be marked at all. Decided before anything is written: the old order
 * moved the booking first and then had the transition refused, which left a
 * missed booking under an application that still read as booked.
 *
 *   - Only a booking nobody arrived for. Arrived, in progress, completed:
 *     the child came, whatever happened after.
 *   - An assessment moves the application to `no_show`, so only from a
 *     status the graph lets reach it.
 *   - A visit returns the family to the start of the booking track only when
 *     the visit was the stage (`statusAfterCancellation`); otherwise the
 *     application stays where it is. Never on a closed application.
 */
export function noShowMove(
  bookingStatus: BookingStatus,
  kind: "assessment" | "visit",
  appStatus: ApplicationStatus
): { ok: true; status: ApplicationStatus | null } | { ok: false; reason: string } {
  if (bookingStatus !== "booked") {
    return {
      ok: false,
      reason:
        bookingStatus === "checked_in" || bookingStatus === "in_progress" || bookingStatus === "completed"
          ? "The child has already been checked in, so this is not a no-show. Cancel the booking if the check-in was a mistake."
          : `This booking is ${APPOINTMENT_LABELS[APPOINTMENT_STATE[bookingStatus]].toLowerCase()}, so it cannot be marked as a no-show.`,
    };
  }
  if (TERMINAL_STATUSES.has(appStatus)) {
    return { ok: false, reason: "This application is closed, so the booking cannot be marked as a no-show." };
  }
  if (kind === "visit") return { ok: true, status: statusAfterCancellation(appStatus) };
  if (!canTransition(appStatus, "no_show")) {
    return { ok: false, reason: "This application is past the assessment, so it cannot be marked as a no-show." };
  }
  return { ok: true, status: "no_show" };
}

export function canMarkNoShow(bookingStatus: BookingStatus, kind: "assessment" | "visit", appStatus: ApplicationStatus): boolean {
  return noShowMove(bookingStatus, kind, appStatus).ok;
}
