import { APPROVED_STATUSES, DIMENSIONS, dimensionKey, FUNNEL_RULES, isDeferred, type Dimension, type FactRow, type FunnelKey } from "@/lib/analytics/breakdown";
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
 * Every figure on the analytics page that is a number of families, and so
 * can be opened as the list of them: the funnel's counts, and the deferred
 * families shown beside it. The rule for a funnel figure is the one
 * `funnelCounts` counts with, never a second copy.
 */
export type FigureKey = FunnelKey | "deferred";

export const FIGURES: Record<FigureKey, { label: string; rule: (r: FactRow) => boolean }> = {
  enquiries: { label: "Every enquiry", rule: FUNNEL_RULES.enquiries },
  bookings: { label: "Booked an assessment", rule: FUNNEL_RULES.bookings },
  attended: { label: "Attended the assessment", rule: FUNNEL_RULES.attended },
  noShows: { label: "Missed the assessment", rule: FUNNEL_RULES.noShows },
  completed: { label: "Assessment completed", rule: FUNNEL_RULES.completed },
  decided: { label: "Decided", rule: FUNNEL_RULES.decided },
  approved: { label: "Approved", rule: FUNNEL_RULES.approved },
  waitlisted: { label: "Waitlisted", rule: FUNNEL_RULES.waitlisted },
  declined: { label: "Declined", rule: FUNNEL_RULES.declined },
  offered: { label: "Offer sent", rule: FUNNEL_RULES.offered },
  accepted: { label: "Offer accepted", rule: FUNNEL_RULES.accepted },
  paid: { label: "Paid", rule: FUNNEL_RULES.paid },
  enrolled: { label: "Enrolled", rule: FUNNEL_RULES.enrolled },
  withdrawn: { label: "Withdrew", rule: FUNNEL_RULES.withdrawn },
  // The rule `deferredSummary` counts with: paused today, at the family's request.
  deferred: { label: "Deferred", rule: isDeferred },
};

export function isFigureKey(v: string | undefined): v is FigureKey {
  return v !== undefined && Object.hasOwn(FIGURES, v);
}

export function isDimension(v: string | undefined): v is Dimension {
  return v !== undefined && (DIMENSIONS as readonly string[]).includes(v);
}

/**
 * Which families a link from analytics names, among those who enquired in
 * the period on screen (and at its campus, which the list reads from its own
 * `campus`): one breakdown group or all of them, and within that either the
 * families a figure counts or the ones a step has not converted. Neither
 * means every enquiry in the group.
 */
export type Drill = {
  step: ConversionStepKey | null;
  figure: FigureKey | null;
  group: { dim: Dimension; key: string } | null;
};

/** The drill a list's query string asks for, or null when it asks for none. */
export function drillFrom(sp: { step?: string; reached?: string; by?: string; value?: string }): Drill | null {
  const step = isConversionStepKey(sp.step) ? sp.step : null;
  const figure = step ? null : isFigureKey(sp.reached) ? sp.reached : null;
  const group = isDimension(sp.by) && sp.value ? { dim: sp.by, key: sp.value } : null;
  return step || figure || group ? { step, figure, group } : null;
}

/** Newest enquiry first, ties by id, so a page holds the same families every time it is read. */
function newestFirst(a: FactRow, b: FactRow): number {
  return b.enquired_at.localeCompare(a.enquired_at) || a.application_id.localeCompare(b.application_id);
}

/** The families a drill names, in the order the applicant list shows them. */
export function drillRows(rows: readonly FactRow[], drill: Drill): FactRow[] {
  const inGroup = drill.group ? (r: FactRow) => dimensionKey(r, drill.group!.dim).key === drill.group!.key : () => true;
  const which = drill.step ? NOT_CONVERTED[drill.step] : drill.figure ? FIGURES[drill.figure].rule : () => true;
  return rows.filter((r) => inGroup(r) && which(r)).sort(newestFirst);
}

/**
 * The step's families, newest enquiry first: the order the applicant list uses.
 * Ties go by id, so families enquiring in the same instant (an import) fall on
 * the same page every time the list is read.
 */
export function notConverted(rows: readonly FactRow[], step: ConversionStepKey): FactRow[] {
  return drillRows(rows, { step, figure: null, group: null });
}

/**
 * Where a figure's families are listed: the applicant list, narrowed to the
 * period and campus on screen and to exactly the families the figure counted.
 */
export function drillHref(
  range: { from: string; to: string },
  campus: string | undefined | null,
  what: { step?: ConversionStepKey; figure?: FigureKey; group?: { dim: Dimension; key: string } },
  /** The breakdown table the link was in, so the way back opens it again. */
  back?: { dim: Dimension }
): string {
  const p = new URLSearchParams();
  if (what.step) p.set("step", what.step);
  else p.set("reached", what.figure ?? "enquiries");
  if (what.group) {
    p.set("by", what.group.dim);
    p.set("value", what.group.key);
  }
  p.set("from", range.from);
  p.set("to", range.to);
  if (campus) p.set("campus", campus);
  if (back) p.set("dim", back.dim);
  return `/staff/applications?${p}`;
}

/**
 * A breakdown group as people read it ("Pre-Kindergarten", not a grade id),
 * from the rows that carry it; the raw value when none of them do.
 */
export function groupLabel(rows: readonly FactRow[], group: { dim: Dimension; key: string }): string {
  for (const r of rows) {
    const k = dimensionKey(r, group.dim);
    if (k.key === group.key) return k.label;
  }
  return group.key;
}

/** What the list holds, worded to lead a sentence: "Offers not yet accepted", "Approved". */
export function drillTitle(drill: Drill): string {
  if (drill.step) {
    const s = NOT_CONVERTED_LABELS[drill.step].many;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return FIGURES[drill.figure ?? "enquiries"].label;
}
