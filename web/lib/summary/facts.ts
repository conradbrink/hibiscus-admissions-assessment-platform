import type { ApplicationStatus } from "@/lib/supabase/types";
import { NEXT_ACTIONS, STATUS_LABELS, TERMINAL_STATUSES, isNextAction } from "@/lib/workflow/states";

/**
 * The applicant's story as plain facts, and the things that need a person's
 * attention, computed from data we hold. Pure and tested. The model, when
 * it writes at all, writes prose over these; it never adds a fact or a flag.
 */

export type SummaryInputs = {
  now: Date;
  application: {
    status: ApplicationStatus;
    next_action: string | null;
    next_action_due_at: string | null;
    created_at: string;
    child_first_name: string;
    requires_assessment: boolean;
    entry_route: string;
    source: string;
  };
  campus: string;
  grade: string;
  intake: string;
  events: Array<{ type: string; occurred_at: string; summary: string }>;
  booking: { starts_at: string; kind: string } | null;
  attempt: { status: string; marking_status: string; submitted_at: string | null } | null;
  decision: { final_outcome: string; decided_by: string; decided_at: string; override_reason: string | null } | null;
  offer: { status: string; expires_at: string | null; sent_at: string | null } | null;
  paymentRequest: { status: string; due_at: string; amount_minor: number; paid_minor: number; currency: string } | null;
  registration: { submitted_at: string | null; prefill_changed: string[]; mismatch_count: number; sections_done: number; sections_total: number; missing_documents: string[]; rejected_documents: string[] } | null;
  openTasks: Array<{ type: string; title: string; due_at: string | null; priority: string }>;
  emailsSent: number;
  messagesSent: number;
  lastInboundMessageAt: string | null;
  siblings: Array<{ child_first_name: string; status: ApplicationStatus }>;
};

export const FLAG_KINDS = [
  "waiting_on_school",
  "missing_documents",
  "document_mismatch",
  "overdue_task",
  "payment_overdue",
  "offer_expiring",
  "no_show_repeat",
  "stalled",
  "sibling_applying",
  "registration_changed_identity",
  "parent_replied",
] as const;

export type FlagKind = (typeof FLAG_KINDS)[number];

export type Flag = { kind: FlagKind; label: string; evidence: string };

export const FLAG_LABELS: Record<FlagKind, string> = {
  waiting_on_school: "Waiting on the school",
  missing_documents: "Documents missing",
  document_mismatch: "Document disagrees with the form",
  overdue_task: "Overdue task",
  payment_overdue: "Payment overdue",
  offer_expiring: "Offer expiring",
  no_show_repeat: "Missed more than once",
  stalled: "No activity",
  sibling_applying: "Sibling applying",
  registration_changed_identity: "Name or date of birth changed",
  parent_replied: "Parent replied on WhatsApp",
};

const STALLED_DAYS = 14;
const OFFER_EXPIRING_DAYS = 3;

function dayString(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

const MILESTONES: Array<[string, string]> = [
  ["booking.created", "Assessment booked"],
  ["booking.rescheduled", "Booking changed"],
  ["booking.no_show", "Missed the assessment"],
  ["booking.checked_in", "Checked in"],
  ["assessment.completed", "Assessment completed"],
  ["decision.made", "Decision recorded"],
  ["offer.sent", "Offer sent"],
  ["offer.accepted", "Offer accepted"],
  ["offer.declined", "Offer declined"],
  ["payment.confirmed", "Fees paid"],
  ["registration.completed", "Registration completed"],
  ["enrolment.completed", "Enrolled"],
  ["application.withdrawn", "Withdrawn"],
];

/** The facts, in order, as short sentences; and the flags with their evidence. */
export function summaryFacts(input: SummaryInputs): { facts: string[]; flags: Flag[] } {
  const facts: string[] = [];
  const flags: Flag[] = [];
  const a = input.application;
  const name = a.child_first_name;
  const now = input.now;

  facts.push(`${name}: ${input.grade} at ${input.campus}, starting ${input.intake}. Enquired ${dayString(a.created_at)} via ${a.entry_route.replace(/_/g, " ")}${a.source !== "website" ? ` (${a.source.replace(/_/g, " ")})` : ""}.`);
  if (!a.requires_assessment) facts.push("Pre-school applicant: no assessment is required.");

  const milestoneLabel = new Map(MILESTONES);
  for (const e of input.events) {
    const label = milestoneLabel.get(e.type);
    if (label) facts.push(`${label} on ${dayString(e.occurred_at)}.`);
  }

  facts.push(`Status: ${STATUS_LABELS[a.status]}.`);
  const na = isNextAction(a.next_action) ? NEXT_ACTIONS[a.next_action] : null;
  if (na && a.next_action !== "none") facts.push(`Next: ${na.staffLabel}${a.next_action_due_at ? `, due ${dayString(a.next_action_due_at)}` : ""}.`);

  if (input.booking) facts.push(`${input.booking.kind === "visit" ? "Visit" : "Assessment"} booked for ${dayString(input.booking.starts_at)}.`);
  if (input.attempt) {
    facts.push(
      input.attempt.status === "submitted" || input.attempt.status === "marked"
        ? `Assessment submitted${input.attempt.submitted_at ? ` on ${dayString(input.attempt.submitted_at)}` : ""}; marking ${input.attempt.marking_status.replace(/_/g, " ")}.`
        : `Assessment attempt is ${input.attempt.status.replace(/_/g, " ")}.`
    );
  }
  if (input.decision) {
    facts.push(
      `Decision: ${input.decision.final_outcome.replace(/_/g, " ")}, by ${input.decision.decided_by === "rules" ? "the rules engine" : "staff"} on ${dayString(input.decision.decided_at)}${input.decision.override_reason ? ` (reason: ${input.decision.override_reason})` : ""}.`
    );
  }
  if (input.offer) {
    facts.push(`Offer ${input.offer.status.replace(/_/g, " ")}${input.offer.expires_at ? `, expires ${dayString(input.offer.expires_at)}` : ""}.`);
    if ((input.offer.status === "sent" || input.offer.status === "viewed") && input.offer.expires_at) {
      const days = daysBetween(now, new Date(input.offer.expires_at));
      if (days <= OFFER_EXPIRING_DAYS) flags.push({ kind: "offer_expiring", label: FLAG_LABELS.offer_expiring, evidence: days < 0 ? `expired ${dayString(input.offer.expires_at)}` : `expires ${dayString(input.offer.expires_at)}` });
    }
  }
  if (input.paymentRequest) {
    const pr = input.paymentRequest;
    const owed = pr.amount_minor - pr.paid_minor;
    facts.push(`Fees ${pr.status.replace(/_/g, " ")}: ${pr.currency} ${(pr.amount_minor / 100).toFixed(2)} requested, ${pr.currency} ${(pr.paid_minor / 100).toFixed(2)} received, due ${dayString(pr.due_at)}.`);
    if (["required", "failed", "partially_paid"].includes(pr.status) && new Date(pr.due_at) < now && owed > 0) {
      flags.push({ kind: "payment_overdue", label: FLAG_LABELS.payment_overdue, evidence: `${pr.currency} ${(owed / 100).toFixed(2)} outstanding since ${dayString(pr.due_at)}` });
    }
  }
  if (input.registration) {
    const r = input.registration;
    facts.push(`Registration: ${r.sections_done} of ${r.sections_total} sections done${r.submitted_at ? `, submitted ${dayString(r.submitted_at)}` : ""}.`);
    const missing = [...r.missing_documents, ...r.rejected_documents.map((d) => `${d} (to upload again)`)];
    if (missing.length) flags.push({ kind: "missing_documents", label: FLAG_LABELS.missing_documents, evidence: missing.join(", ") });
    if (r.mismatch_count > 0) flags.push({ kind: "document_mismatch", label: FLAG_LABELS.document_mismatch, evidence: `${r.mismatch_count} field(s) flagged for the parent to check` });
    if (r.prefill_changed.length) flags.push({ kind: "registration_changed_identity", label: FLAG_LABELS.registration_changed_identity, evidence: r.prefill_changed.map((f) => f.replace("child_", "").replace(/_/g, " ")).join(", ") });
  }

  const noShows = input.events.filter((e) => e.type === "booking.no_show").length;
  if (noShows >= 2) flags.push({ kind: "no_show_repeat", label: FLAG_LABELS.no_show_repeat, evidence: `${noShows} missed assessments` });

  const overdue = input.openTasks.filter((t) => t.due_at && new Date(t.due_at) < now);
  if (overdue.length) flags.push({ kind: "overdue_task", label: FLAG_LABELS.overdue_task, evidence: overdue.map((t) => t.title).join("; ") });
  if (input.openTasks.some((t) => t.type === "parent_replied")) flags.push({ kind: "parent_replied", label: FLAG_LABELS.parent_replied, evidence: input.lastInboundMessageAt ? `last reply ${dayString(input.lastInboundMessageAt)}` : "open task" });
  if (input.openTasks.length) facts.push(`${input.openTasks.length} open task(s): ${input.openTasks.map((t) => t.title).join("; ")}.`);

  if (["staff_review", "offer_pending_approval", "offer_draft", "registration_complete", "awaiting_decision", "callback_requested"].includes(a.status)) {
    flags.push({ kind: "waiting_on_school", label: FLAG_LABELS.waiting_on_school, evidence: STATUS_LABELS[a.status] });
  }

  const last = input.events.reduce<Date | null>((acc, e) => {
    const d = new Date(e.occurred_at);
    return !acc || d > acc ? d : acc;
  }, null);
  const lastActivity = last ?? new Date(a.created_at);
  const quietDays = daysBetween(lastActivity, now);
  if (!TERMINAL_STATUSES.has(a.status) && quietDays >= STALLED_DAYS) flags.push({ kind: "stalled", label: FLAG_LABELS.stalled, evidence: `${quietDays} days since the last event` });

  facts.push(`${input.emailsSent} email(s) and ${input.messagesSent} WhatsApp message(s) sent.`);
  if (input.siblings.length) {
    facts.push(`Sibling application(s): ${input.siblings.map((s) => `${s.child_first_name} (${STATUS_LABELS[s.status]})`).join(", ")}.`);
    flags.push({ kind: "sibling_applying", label: FLAG_LABELS.sibling_applying, evidence: input.siblings.map((s) => s.child_first_name).join(", ") });
  }

  return { facts, flags };
}
