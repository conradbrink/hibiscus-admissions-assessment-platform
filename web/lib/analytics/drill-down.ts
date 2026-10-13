import { APPROVED_STATUSES, type FactRow } from "@/lib/analytics/breakdown";
import type { ConversionStepKey } from "@/lib/analytics/compare";

/**
 * The families a conversion step has not converted: the ones it started from
 * that have not taken it. Analytics shows how many, and the applicant list
 * opened from that step shows exactly these, so the two say the same number.
 *
 * The links used to open the list at a status ("no-shows", "offers awaiting a
 * reply") for every family at that status today, whatever month they enquired
 * in, while the step beside them was about the period on screen. The number
 * found there was almost always a different one, usually smaller.
 *
 * Each rule is the complement of the numerator in `funnelCounts`, inside its
 * denominator. Families who are still on their way count too: "not yet" is
 * what the step measures, and the list says where each one is now.
 */
export const NOT_CONVERTED: Record<ConversionStepKey, (r: FactRow) => boolean> = {
  enquiryToBooking: (r) => r.requires_assessment && !r.booked_at,
  bookingToAttendance: (r) => r.requires_assessment && Boolean(r.booked_at) && !r.attended_at,
  approvalRate: (r) => Boolean(r.decided_at) && r.decision_outcome !== "approved" && !APPROVED_STATUSES.has(r.status),
  offerToAcceptance: (r) => Boolean(r.offered_at) && !r.accepted_at,
  acceptanceToPayment: (r) => Boolean(r.accepted_at) && !r.paid_at,
  paymentToEnrolment: (r) => Boolean(r.paid_at) && !r.enrolled_at,
};

/** What those families are, worded to follow a count: "12 not yet booked". */
export const NOT_CONVERTED_LABELS: Record<ConversionStepKey, { one: string; many: string }> = {
  enquiryToBooking: { one: "enquiry not yet booked", many: "enquiries not yet booked" },
  bookingToAttendance: { one: "booking not attended", many: "bookings not attended" },
  approvalRate: { one: "decision not approved", many: "decisions not approved" },
  offerToAcceptance: { one: "offer not yet accepted", many: "offers not yet accepted" },
  acceptanceToPayment: { one: "acceptance not yet paid", many: "acceptances not yet paid" },
  paymentToEnrolment: { one: "payment not yet enrolled", many: "payments not yet enrolled" },
};

export function isConversionStepKey(v: string | undefined): v is ConversionStepKey {
  return v !== undefined && Object.hasOwn(NOT_CONVERTED, v);
}

/**
 * The step's families, newest enquiry first: the order the applicant list uses.
 * Ties go by id, so families enquiring in the same instant (an import) fall on
 * the same page every time the list is read.
 */
export function notConverted(rows: readonly FactRow[], step: ConversionStepKey): FactRow[] {
  return rows
    .filter(NOT_CONVERTED[step])
    .sort((a, b) => b.enquired_at.localeCompare(a.enquired_at) || a.application_id.localeCompare(b.application_id));
}
