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
  ],
  visit_booked: ["new_enquiry", "assessment_booked", "awaiting_decision", "visit_booked"],
  callback_requested: ["new_enquiry", "assessment_booked", "visit_booked", "awaiting_decision"],
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
  awaiting_decision: ["staff_review", "approved", "waitlisted", "declined"],
  staff_review: ["approved", "waitlisted", "declined"],
  approved: ["offer_draft", "waitlisted"],
  waitlisted: ["approved", "declined"],
  declined: [],
  offer_draft: ["offer_pending_approval", "offer_sent"],
  offer_pending_approval: ["offer_sent", "offer_draft"],
  offer_sent: ["offer_accepted", "offer_declined", "offer_expired"],
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
  "await_results",
  "await_decision",
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

export function isNextAction(value: string | null | undefined): value is NextAction {
  return (NEXT_ACTION_KEYS as readonly string[]).includes(value ?? "");
}
