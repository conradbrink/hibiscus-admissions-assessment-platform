import type { ApplicationStatus, LifecycleStage, StudentStatus } from "@/lib/supabase/types";

/**
 * Where a family is with the school.
 *
 * The database computes the stage (`crm_compute_lifecycle`, migration
 * 20260919100000) from what admissions and the register already know, so
 * nobody types the same fact twice. This file is the same rule in
 * TypeScript — for the tests, and for a screen that wants to say what the
 * stage *would* be before a row is written — plus the words and colours.
 *
 * The two must agree. `lifecycle.test.ts` pins this one; the SQL is exercised
 * by the security suite's CRM cases.
 */

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  "new_enquiry",
  "qualified",
  "applicant",
  "assessment",
  "offer",
  "onboarding",
  "active",
  "reenrolment",
  "alumni",
  "inactive",
] as const;

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  new_enquiry: "New enquiry",
  qualified: "Qualified",
  applicant: "Applicant",
  assessment: "Assessment",
  offer: "Offer",
  onboarding: "Onboarding",
  active: "Active family",
  reenrolment: "Re-enrolment",
  alumni: "Alumni",
  inactive: "Inactive",
};

export const LIFECYCLE_TONE: Record<LifecycleStage, "info" | "success" | "warning" | "muted" | "secondary" | "default"> = {
  new_enquiry: "info",
  qualified: "info",
  applicant: "info",
  assessment: "warning",
  offer: "warning",
  onboarding: "secondary",
  active: "success",
  reenrolment: "warning",
  alumni: "muted",
  inactive: "muted",
};

/** One line under the stage on a profile, saying what it means. */
export const LIFECYCLE_BLURB: Record<LifecycleStage, string> = {
  new_enquiry: "The family has asked about a place and nothing has been booked yet.",
  qualified: "A visit or a play date is booked.",
  applicant: "An assessment is booked.",
  assessment: "The child is being assessed, or is waiting for a decision.",
  offer: "An offer is being drafted, is out with the family, or the child is waitlisted.",
  onboarding: "The place is accepted and the family is on its way in.",
  active: "A child is attending.",
  reenrolment: "The school is waiting to hear whether the children are coming back.",
  alumni: "Every child has left or graduated.",
  inactive: "The last enquiry was declined or withdrawn, and nobody is enrolled.",
};

const ONBOARDING_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "offer_accepted",
  "payment_required",
  "payment_processing",
  "paid",
  "registration_incomplete",
  "registration_complete",
  "enrolled",
]);
const OFFER_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "approved",
  "waitlisted",
  "offer_draft",
  "offer_pending_approval",
  "offer_sent",
  "offer_expired",
]);
const ASSESSMENT_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "assessment_in_progress",
  "assessment_completed",
  "awaiting_decision",
  "staff_review",
  "no_show",
  "deferred",
]);

export type LifecycleInput = {
  studentStatuses: readonly StudentStatus[];
  applicationStatuses: readonly ApplicationStatus[];
  /** Unanswered questions in an open re-enrolment round. */
  reenrolmentOutstanding: number;
};

/**
 * The same ordering as `crm_compute_lifecycle`: most-with-us first. An open
 * re-enrolment question outranks everything because it is the one thing the
 * school is waiting on the family for.
 */
export function deriveLifecycle(input: LifecycleInput): LifecycleStage {
  const s = input.studentStatuses;
  const a = input.applicationStatuses;
  if (input.reenrolmentOutstanding > 0) return "reenrolment";
  if (s.some((x) => x === "active" || x === "on_leave")) return "active";
  if (s.some((x) => x === "onboarding")) return "onboarding";
  if (a.some((x) => ONBOARDING_STATUSES.has(x))) return "onboarding";
  if (a.some((x) => OFFER_STATUSES.has(x))) return "offer";
  if (a.some((x) => ASSESSMENT_STATUSES.has(x))) return "assessment";
  if (a.includes("assessment_booked")) return "applicant";
  if (a.includes("visit_booked")) return "qualified";
  if (a.some((x) => x === "new_enquiry" || x === "callback_requested")) return "new_enquiry";
  if (s.some((x) => x === "left" || x === "graduated")) return "alumni";
  if (a.length > 0) return "inactive";
  return "new_enquiry";
}

export function isLifecycleStage(value: string | null | undefined): value is LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(value ?? "");
}

/** The dashboard's pipeline: the stages in order, with the two end states last. */
export const PIPELINE_STAGES: readonly LifecycleStage[] = [
  "new_enquiry",
  "qualified",
  "applicant",
  "assessment",
  "offer",
  "onboarding",
  "active",
  "reenrolment",
  "alumni",
];
