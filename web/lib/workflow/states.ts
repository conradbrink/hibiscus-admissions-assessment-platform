import { bookingNoun, type BookingNounInput } from "@/lib/booking/noun";
import type { ApplicationStatus } from "@/lib/supabase/types";

/**
 * The state machine, as data.
 *
 * This is the one place that says which pipeline moves are legal. The engine
 * refuses anything not listed here before it reaches the database, and the
 * unit tests walk every entry. Reachability is decided in code, on purpose:
 * an administrator can change every number the machine consults (reminder
 * offsets, expiry windows) through settings, but rewiring the graph is a
 * reviewed change, because a graph with an unreachable state strands real
 * families in it.
 *
 * ⚠️ `withdrawn` is reachable from every non-terminal state and is not
 * listed per state; see {@link canTransition}.
 */
export const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  new_enquiry: [
    "assessment_booked",
    "visit_booked",
    "callback_requested",
    // Assessment-exempt grades go straight to a decision.
    "awaiting_decision",
    "deferred",
  ],
  visit_booked: ["new_enquiry", "assessment_booked", "awaiting_decision", "visit_booked", "deferred"],
  callback_requested: ["new_enquiry", "assessment_booked", "visit_booked", "awaiting_decision", "deferred"],
  assessment_booked: [
    "no_show",
    "assessment_in_progress",
    "assessment_completed",
    // Reschedule keeps the status; cancel returns to enquiry.
    "assessment_booked",
    "new_enquiry",
  ],
  no_show: ["assessment_booked", "new_enquiry"],
  assessment_in_progress: ["assessment_completed", "assessment_booked"],
  assessment_completed: ["awaiting_decision"],
  awaiting_decision: ["staff_review", "approved", "waitlisted", "declined", "deferred"],
  staff_review: ["approved", "waitlisted", "declined", "deferred"],
  // Paused, not closed. One way back, and it is the same one every time: the
  // family is where they were, waiting on the school's answer. Reversible in
  // one click is the whole point — a status a family cannot come back from is
  // the Withdraw it was invented to replace.
  deferred: ["awaiting_decision"],
  approved: ["offer_draft", "waitlisted"],
  waitlisted: ["approved", "declined"],
  declined: [],
  offer_draft: ["offer_pending_approval", "offer_sent"],
  offer_pending_approval: ["offer_sent", "offer_draft"],
  // Back to draft: staff withdraw a sent offer to correct it and re-issue.
  offer_sent: ["offer_accepted", "offer_declined", "offer_expired", "offer_draft"],
  offer_expired: ["offer_sent", "offer_draft"],
  offer_declined: ["offer_draft"],
  offer_accepted: ["payment_required"],
  payment_required: ["payment_processing", "paid"],
  payment_processing: ["paid", "payment_required"],
  paid: ["registration_incomplete"],
  registration_incomplete: ["registration_complete"],
  registration_complete: ["enrolled"],
  enrolled: [],
  withdrawn: [],
};

export const TERMINAL_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "enrolled",
  "withdrawn",
  "declined",
]);

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (to === "withdrawn") return !TERMINAL_STATUSES.has(from);
  return TRANSITIONS[from].includes(to);
}

/**
 * Where a booking leaves the application, or null to leave it alone.
 *
 * Booking is a stage of the funnel only at the beginning of it. A family
 * whose offer is already out may still want to walk round the campus before
 * they accept, and a pre-school enquiry goes straight to a decision and can
 * be visiting while the offer is being approved.
 *
 * Until now the booking was created by `book_session` and the status moved by
 * a second call, so a visit booked from `offer_sent` inserted the booking and
 * *then* refused the move: the parent was told in red that the booking had
 * failed, the booking existed anyway, and the confirmation email was never
 * queued — leaving the enquiry email, which invites them to book, as the last
 * word. Recording the booking and leaving the application where it is says
 * what actually happened.
 */
export function statusAfterBooking(
  from: ApplicationStatus,
  kind: "assessment" | "visit"
): ApplicationStatus | null {
  const to: ApplicationStatus = kind === "visit" ? "visit_booked" : "assessment_booked";
  return canTransition(from, to) ? to : null;
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: ApplicationStatus,
    public readonly to: ApplicationStatus
  ) {
    super(`Illegal transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  new_enquiry: "New enquiry",
  visit_booked: "Visit booked",
  callback_requested: "Callback requested",
  assessment_booked: "Assessment booked",
  no_show: "No-show",
  assessment_in_progress: "Assessment in progress",
  assessment_completed: "Assessment completed",
  awaiting_decision: "Awaiting decision",
  staff_review: "Staff review",
  approved: "Approved",
  deferred: "Deferred",
  waitlisted: "Waitlisted",
  declined: "Declined",
  offer_draft: "Offer draft",
  offer_pending_approval: "Offer pending approval",
  offer_sent: "Offer sent",
  offer_expired: "Offer expired",
  offer_declined: "Offer declined",
  offer_accepted: "Offer accepted",
  payment_required: "Payment required",
  payment_processing: "Payment processing",
  paid: "Paid",
  registration_incomplete: "Registration incomplete",
  registration_complete: "Registration complete",
  enrolled: "Enrolled",
  withdrawn: "Withdrawn",
};

export type StatusTone = "muted" | "info" | "warning" | "success" | "destructive" | "default";

export const STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  new_enquiry: "info",
  visit_booked: "info",
  callback_requested: "warning",
  assessment_booked: "info",
  no_show: "warning",
  assessment_in_progress: "info",
  assessment_completed: "success",
  awaiting_decision: "warning",
  staff_review: "warning",
  approved: "success",
  // Not a warning: nobody is late, the family asked for this.
  deferred: "muted",
  waitlisted: "muted",
  declined: "destructive",
  offer_draft: "muted",
  offer_pending_approval: "warning",
  offer_sent: "info",
  offer_expired: "warning",
  offer_declined: "destructive",
  offer_accepted: "success",
  payment_required: "warning",
  payment_processing: "info",
  paid: "success",
  registration_incomplete: "warning",
  registration_complete: "success",
  enrolled: "success",
  withdrawn: "muted",
};

/** Columns of the pipeline board, in order. */
export const PIPELINE_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  statuses: readonly ApplicationStatus[];
}> = [
  { key: "enquiry", label: "Enquiries", statuses: ["new_enquiry", "callback_requested", "visit_booked"] },
  {
    key: "assessment",
    label: "Assessment",
    statuses: ["assessment_booked", "no_show", "assessment_in_progress", "assessment_completed"],
  },
  { key: "decision", label: "Decision", statuses: ["awaiting_decision", "staff_review"] },
  // `deferred` is deliberately not a column. The board is the work in front of
  // the school, and a family who asked to be called in March is not work in
  // March minus four months. They are found by their own filter, and the
  // dashboard raises them when their date comes near.
  { key: "outcome", label: "Outcome", statuses: ["approved", "waitlisted", "declined"] },
  {
    key: "offer",
    label: "Offer",
    statuses: ["offer_draft", "offer_pending_approval", "offer_sent", "offer_expired", "offer_declined", "offer_accepted"],
  },
  { key: "payment", label: "Payment", statuses: ["payment_required", "payment_processing", "paid"] },
  {
    key: "registration",
    label: "Registration",
    statuses: ["registration_incomplete", "registration_complete", "enrolled"],
  },
];

// ---------------------------------------------------------------------------
// Next actions — "What happens next?"
// ---------------------------------------------------------------------------

export const NEXT_ACTION_KEYS = [
  "book_assessment",
  "attend_assessment",
  "rebook_assessment",
  "attend_visit",
  "await_callback",
  "await_school_contact",
  "await_deferred_date",
  "await_results",
  "await_decision",
  "await_offer",
  "view_profile",
  "review_offer",
  "pay_fees",
  "complete_registration",
  "none",
] as const;

export type NextAction = (typeof NEXT_ACTION_KEYS)[number];

export type NextActionCopy = {
  /** Shown to the parent on /next. One sentence. */
  parentTitle: string;
  parentDetail: string;
  /** Null means "No action required." — no button. */
  parentCta: { label: string; href: string } | null;
  /** Shown to staff in the pipeline. */
  staffLabel: string;
};

export const NEXT_ACTIONS: Record<NextAction, NextActionCopy> = {
  book_assessment: {
    parentTitle: "Your next step is to book an assessment.",
    parentDetail: "Choose a date and time that suits you. It takes about a minute.",
    parentCta: { label: "Book assessment", href: "/next/book" },
    staffLabel: "Parent to book assessment",
  },
  attend_assessment: {
    parentTitle: "Your next step is to attend the assessment.",
    parentDetail: "Arrive ten minutes early and give reception your name. There is no paperwork.",
    parentCta: { label: "View booking", href: "/next/booking" },
    staffLabel: "Attend assessment",
  },
  rebook_assessment: {
    parentTitle: "We missed you — let's find another time.",
    parentDetail: "Choose a new date and time for the assessment.",
    parentCta: { label: "Rebook assessment", href: "/next/book" },
    staffLabel: "Parent to rebook after no-show",
  },
  attend_visit: {
    parentTitle: "Your next step is to visit the campus.",
    parentDetail: "We look forward to showing you around.",
    parentCta: { label: "View visit", href: "/next/booking" },
    staffLabel: "Attend campus visit",
  },
  await_callback: {
    parentTitle: "No action required.",
    parentDetail: "A member of our admissions team will call you, usually within one working day.",
    parentCta: null,
    staffLabel: "Call parent",
  },
  await_school_contact: {
    parentTitle: "No action required.",
    parentDetail: "Our admissions team is reviewing availability and will be in touch shortly.",
    parentCta: null,
    staffLabel: "Review pre-school enquiry",
  },
  await_deferred_date: {
    parentTitle: "No action required.",
    parentDetail: "We will be in touch closer to the time you asked us to call.",
    parentCta: null,
    staffLabel: "Deferred — waiting for the date",
  },
  await_results: {
    parentTitle: "No action required.",
    parentDetail: "The assessment is complete. Results will be emailed to you.",
    parentCta: null,
    staffLabel: "Results pending",
  },
  await_decision: {
    parentTitle: "No action required.",
    parentDetail: "Your application is being reviewed. We will email you as soon as there is news.",
    parentCta: null,
    staffLabel: "Decision pending",
  },
  await_offer: {
    parentTitle: "No action required.",
    parentDetail: "Good news is on its way: we are preparing your offer and will email it shortly.",
    parentCta: null,
    staffLabel: "Offer being prepared",
  },
  view_profile: {
    parentTitle: "No action required.",
    parentDetail: "The learning profile is ready to read whenever you like.",
    parentCta: { label: "View learning profile", href: "/profile" },
    staffLabel: "Profile shared",
  },
  review_offer: {
    parentTitle: "Your next step is to review and accept your offer.",
    parentDetail: "Your offer of admission is ready.",
    parentCta: { label: "View offer", href: "/offer" },
    staffLabel: "Parent to accept offer",
  },
  pay_fees: {
    parentTitle: "Your next step is to pay the registration and admission fees.",
    parentDetail: "Payment secures the place.",
    parentCta: { label: "Make payment", href: "/pay" },
    staffLabel: "Parent to pay",
  },
  complete_registration: {
    parentTitle: "Your next step is to complete registration.",
    parentDetail: "We only ask for what we do not already have.",
    parentCta: { label: "Complete registration", href: "/register" },
    staffLabel: "Parent to complete registration",
  },
  none: {
    parentTitle: "No action required.",
    parentDetail: "There is nothing you need to do right now.",
    parentCta: null,
    staffLabel: "—",
  },
};

/**
 * The copy for one next action, with the booking called what this family's
 * booking is called.
 *
 * Only `attend_visit` moves: a pre-school family books a play date and a
 * primary family looking around books a visit, and both store the same
 * `next_action`. Adding a second code would mean a constraint change and a
 * second row in every consumer, for one word.
 */
export function nextActionCopy(action: NextAction, input: BookingNounInput): NextActionCopy {
  const copy = NEXT_ACTIONS[action];
  if (action !== "attend_visit" || bookingNoun(input) !== "play date") return copy;
  return {
    parentTitle: "Your next step is to come for the play date.",
    parentDetail: "Come and play, look around, and ask us anything. There is nothing to bring.",
    parentCta: { label: "View play date", href: "/next/booking" },
    staffLabel: "Attend play date",
  };
}

export function isNextAction(value: string | null | undefined): value is NextAction {
  return (NEXT_ACTION_KEYS as readonly string[]).includes(value ?? "");
}
