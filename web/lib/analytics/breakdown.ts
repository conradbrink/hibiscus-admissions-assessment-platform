import type { ApplicationStatus } from "@/lib/supabase/types";

/**
 * The analytics arithmetic over the facts view, pure and tested: the
 * funnel counts the specification lists, conversion between stages, cycle
 * times as medians, and the same grouped by any dimension.
 */

export type FactRow = {
  application_id: string;
  campus_id: string;
  campus_name: string;
  grade_id: string;
  grade_name: string;
  grade_sort: number;
  intake_id: string;
  intake_label: string;
  entry_route: string;
  source: string;
  requires_assessment: boolean;
  status: ApplicationStatus;
  enquired_at: string;
  booked_at: string | null;
  attended_at: string | null;
  no_show_at: string | null;
  assessed_at: string | null;
  decided_at: string | null;
  offered_at: string | null;
  accepted_at: string | null;
  paid_at: string | null;
  enrolled_at: string | null;
  withdrawn_at: string | null;
  decision_outcome: string | null;
  offer_status: string | null;
  paid_minor: number;
  emails_sent: number;
  messages_sent: number;
  no_show_count: number;
  prefilled_count: number;
  prefill_changed_count: number;
  registration_submitted: boolean;
};

export const APPROVED_STATUSES: ReadonlySet<string> = new Set([
  "approved", "offer_draft", "offer_pending_approval", "offer_sent", "offer_expired", "offer_declined", "offer_accepted",
  "payment_required", "payment_processing", "paid", "registration_incomplete", "registration_complete", "enrolled",
]);

export type FunnelCounts = {
  enquiries: number;
  bookings: number;
  attended: number;
  noShows: number;
  completed: number;
  decided: number;
  approved: number;
  waitlisted: number;
  declined: number;
  offered: number;
  accepted: number;
  paid: number;
  enrolled: number;
  withdrawn: number;
};

export function funnelCounts(rows: FactRow[]): FunnelCounts {
  const assessed = rows.filter((r) => r.requires_assessment);
  const approvedByDecision = rows.filter((r) => r.decision_outcome === "approved" || APPROVED_STATUSES.has(r.status)).length;
  return {
    enquiries: rows.length,
    bookings: assessed.filter((r) => r.booked_at).length,
    attended: assessed.filter((r) => r.attended_at).length,
    noShows: assessed.filter((r) => r.no_show_at).length,
    completed: assessed.filter((r) => r.assessed_at).length,
    decided: rows.filter((r) => r.decided_at).length,
    approved: approvedByDecision,
    waitlisted: rows.filter((r) => r.decision_outcome === "waitlisted" || r.status === "waitlisted").length,
    declined: rows.filter((r) => r.decision_outcome === "declined" || r.status === "declined").length,
    offered: rows.filter((r) => r.offered_at).length,
    accepted: rows.filter((r) => r.accepted_at).length,
    paid: rows.filter((r) => r.paid_at).length,
    enrolled: rows.filter((r) => r.enrolled_at).length,
    withdrawn: rows.filter((r) => r.status === "withdrawn").length,
  };
}

export function rate(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

/** The stage-to-stage percentages the specification asks for, as fractions (null when the denominator is zero). */
export function conversion(c: FunnelCounts, assessedEnquiries: number) {
  return {
    enquiryToBooking: rate(c.bookings, assessedEnquiries),
    bookingToAttendance: rate(c.attended, c.bookings),
    assessmentToOffer: rate(c.offered, c.completed),
    approvalRate: rate(c.approved, c.decided),
    offerToAcceptance: rate(c.accepted, c.offered),
    acceptanceToPayment: rate(c.paid, c.accepted),
    paymentToEnrolment: rate(c.enrolled, c.paid),
    enquiryToEnrolment: rate(c.enrolled, c.enquiries),
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function days(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function medianDays(rows: FactRow[], from: (r: FactRow) => string | null, to: (r: FactRow) => string | null): number | null {
  return median(rows.map((r) => days(from(r), to(r))).filter((v): v is number => v !== null && v >= 0));
}

/** Median days between the milestones the specification names. */
export function cycleTimes(rows: FactRow[]) {
  const assessed = rows.filter((r) => r.requires_assessment);
  return {
    enquiryToBooking: medianDays(assessed, (r) => r.enquired_at, (r) => r.booked_at),
    bookingToAssessment: medianDays(assessed, (r) => r.booked_at, (r) => r.assessed_at),
    assessmentToDecision: medianDays(rows, (r) => r.assessed_at ?? r.enquired_at, (r) => r.decided_at),
    decisionToOffer: medianDays(rows, (r) => r.decided_at, (r) => r.offered_at),
    offerToAcceptance: medianDays(rows, (r) => r.offered_at, (r) => r.accepted_at),
    acceptanceToPayment: medianDays(rows, (r) => r.accepted_at, (r) => r.paid_at),
    paymentToEnrolment: medianDays(rows, (r) => r.paid_at, (r) => r.enrolled_at),
  };
}

export const DIMENSIONS = ["campus", "grade", "month", "week", "source", "entry_route", "outcome"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  campus: "Campus",
  grade: "Grade",
  month: "Month enquired",
  week: "Week enquired",
  source: "Lead source",
  entry_route: "Entry route",
  outcome: "Assessment outcome",
};

/** ISO week's Monday as YYYY-MM-DD, in UTC; enquiries cluster by week of enquiry. */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function dimensionKey(r: FactRow, dim: Dimension): { key: string; label: string; sort: string | number } {
  switch (dim) {
    case "campus":
      return { key: r.campus_id, label: r.campus_name, sort: r.campus_name };
    case "grade":
      return { key: r.grade_id, label: r.grade_name, sort: r.grade_sort };
    case "month":
      return { key: monthKey(r.enquired_at), label: monthKey(r.enquired_at), sort: monthKey(r.enquired_at) };
    case "week":
      return { key: weekKey(r.enquired_at), label: `w/c ${weekKey(r.enquired_at)}`, sort: weekKey(r.enquired_at) };
    case "source":
      return { key: r.source, label: r.source.replace(/_/g, " "), sort: r.source };
    case "entry_route":
      return { key: r.entry_route, label: r.entry_route.replace(/_/g, " "), sort: r.entry_route };
    case "outcome": {
      const o = r.decision_outcome ?? (r.decided_at ? "unknown" : "not decided");
      return { key: o, label: o.replace(/_/g, " "), sort: o };
    }
  }
}

export type Breakdown = { key: string; label: string; rows: FactRow[]; counts: FunnelCounts; enquiryToEnrolment: number | null };

export function groupBy(rows: FactRow[], dim: Dimension): Breakdown[] {
  const groups = new Map<string, { label: string; sort: string | number; rows: FactRow[] }>();
  for (const r of rows) {
    const k = dimensionKey(r, dim);
    const g = groups.get(k.key) ?? { label: k.label, sort: k.sort, rows: [] };
    g.rows.push(r);
    groups.set(k.key, g);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    .map(([key, g]) => {
      const counts = funnelCounts(g.rows);
      return { key, label: g.label, rows: g.rows, counts, enquiryToEnrolment: rate(counts.enrolled, counts.enquiries) };
    });
}

/** Weekly series for the trend chart: enquiries by week of enquiry, enrolments by week of enrolment, over a continuous range. */
export function weeklySeries(rows: FactRow[], from: string, to: string): Array<{ week: string; enquiries: number; enrolments: number }> {
  const start = weekKey(`${from}T00:00:00Z`);
  const end = weekKey(`${to}T00:00:00Z`);
  const weeks: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 7)) weeks.push(d.toISOString().slice(0, 10));
  const enq = new Map<string, number>();
  const enr = new Map<string, number>();
  for (const r of rows) {
    enq.set(weekKey(r.enquired_at), (enq.get(weekKey(r.enquired_at)) ?? 0) + 1);
    if (r.enrolled_at) enr.set(weekKey(r.enrolled_at), (enr.get(weekKey(r.enrolled_at)) ?? 0) + 1);
  }
  return weeks.map((w) => ({ week: w, enquiries: enq.get(w) ?? 0, enrolments: enr.get(w) ?? 0 }));
}

/** Stage 28: the parent-effort figures beyond the funnel timer. */
export function parentEffort(rows: FactRow[], enquiryFieldCount: number) {
  const registered = rows.filter((r) => r.registration_submitted);
  const prefilled = registered.reduce((n, r) => n + r.prefilled_count, 0);
  const changed = registered.reduce((n, r) => n + r.prefill_changed_count, 0);
  const assessed = rows.filter((r) => r.requires_assessment);
  return {
    fieldsBeforeAssessment: enquiryFieldCount,
    staffAssisted: rate(rows.filter((r) => r.source !== "website").length, rows.length),
    bookingAbandonment: rate(assessed.filter((r) => !r.booked_at && !["withdrawn", "declined"].includes(r.status)).length, assessed.length),
    messagesPerApplicant: rate(rows.reduce((n, r) => n + r.emails_sent + r.messages_sent, 0), rows.length),
    emailsPerApplicant: rate(rows.reduce((n, r) => n + r.emails_sent, 0), rows.length),
    prefilledAtRegistration: rate(prefilled - changed, prefilled),
    registrationsSubmitted: registered.length,
  };
}

export function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export function fmtDays(v: number | null): string {
  if (v === null) return "—";
  if (v < 1) return `${Math.round(v * 24)}h`;
  return `${v.toFixed(1)}d`;
}

/** The breakdown as CSV rows for the export route. */
export function breakdownCsvRows(dim: Dimension, groups: Breakdown[]): { headers: string[]; rows: string[][] } {
  const headers = [DIMENSION_LABELS[dim], "Enquiries", "Bookings", "Attended", "No-shows", "Assessed", "Decided", "Approved", "Waitlisted", "Declined", "Offers sent", "Accepted", "Paid", "Enrolled", "Withdrawn", "Enquiry to enrolment %"];
  const rows = groups.map((g) => [
    g.label,
    ...[g.counts.enquiries, g.counts.bookings, g.counts.attended, g.counts.noShows, g.counts.completed, g.counts.decided, g.counts.approved, g.counts.waitlisted, g.counts.declined, g.counts.offered, g.counts.accepted, g.counts.paid, g.counts.enrolled, g.counts.withdrawn].map(String),
    g.enquiryToEnrolment === null ? "" : (g.enquiryToEnrolment * 100).toFixed(1),
  ]);
  return { headers, rows };
}
