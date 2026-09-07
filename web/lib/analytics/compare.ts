import { conversion, cycleTimes, funnelCounts, rate, type Breakdown, type FactRow, type FunnelCounts } from "@/lib/analytics/breakdown";

/**
 * The reading layer over the funnel: a handful of headline figures, each
 * with the same figure for the period before, so a number comes with
 * "up or down, and by how much"; the funnel as stages with the share of
 * enquiries that reached each and the step-to-step conversion; and shares
 * for a breakdown. Pure and tested; the pages only draw.
 */

/** The period of the same length ending the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
  const prevTo = new Date(a.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

export type Delta = { abs: number; pct: number | null; direction: "up" | "down" | "flat" };

/** The change from `previous` to `current`; percentages compare as points, counts as a ratio. */
export function delta(current: number | null, previous: number | null, kind: "count" | "fraction" | "days" = "count"): Delta | null {
  if (current === null || previous === null) return null;
  const abs = current - previous;
  const direction = Math.abs(abs) < 1e-9 ? "flat" : abs > 0 ? "up" : "down";
  if (kind === "fraction") return { abs, pct: null, direction };
  return { abs, pct: previous === 0 ? null : abs / previous, direction };
}

export type Headline = {
  enquiries: number;
  enrolled: number;
  enquiryToEnrolment: number | null;
  offerAcceptance: number | null;
  noShowRate: number | null;
  approvalRate: number | null;
  medianDaysToOffer: number | null;
  medianDaysOfferToPaid: number | null;
};

export function headline(rows: FactRow[]): Headline {
  const c = funnelCounts(rows);
  const conv = conversion(c, rows.filter((r) => r.requires_assessment).length);
  const cycle = cycleTimes(rows);
  const toOffer = [cycle.enquiryToBooking, cycle.bookingToAssessment, cycle.assessmentToDecision, cycle.decisionToOffer];
  return {
    enquiries: c.enquiries,
    enrolled: c.enrolled,
    enquiryToEnrolment: conv.enquiryToEnrolment,
    offerAcceptance: conv.offerToAcceptance,
    noShowRate: rate(c.noShows, c.bookings),
    approvalRate: conv.approvalRate,
    medianDaysToOffer: toOffer.every((v) => v !== null) ? toOffer.reduce((n, v) => n + (v ?? 0), 0) : null,
    medianDaysOfferToPaid: cycle.offerToAcceptance !== null && cycle.acceptanceToPayment !== null ? cycle.offerToAcceptance + cycle.acceptanceToPayment : null,
  };
}

export type FunnelStage = { key: string; label: string; count: number; ofTop: number | null; step: number | null };

/** The funnel as drawn: each stage's count, share of enquiries, and conversion from the stage before. */
export function funnelStages(c: FunnelCounts): FunnelStage[] {
  const stages: Array<[string, string, number]> = [
    ["enquiries", "Enquiries", c.enquiries],
    ["bookings", "Booked an assessment", c.bookings],
    ["attended", "Attended", c.attended],
    ["completed", "Assessment completed", c.completed],
    ["approved", "Approved", c.approved],
    ["offered", "Offer sent", c.offered],
    ["accepted", "Offer accepted", c.accepted],
    ["paid", "Paid", c.paid],
    ["enrolled", "Enrolled", c.enrolled],
  ];
  return stages.map(([key, label, count], i) => ({
    key,
    label,
    count,
    ofTop: rate(count, c.enquiries),
    step: i === 0 ? null : rate(count, stages[i - 1][2]),
  }));
}

export type Share = { key: string; label: string; count: number; share: number | null; enrolled: number; enquiryToEnrolment: number | null };

/** A breakdown as shares of the whole, largest first. */
export function shares(groups: Breakdown[]): Share[] {
  const total = groups.reduce((n, g) => n + g.counts.enquiries, 0);
  return groups
    .map((g) => ({ key: g.key, label: g.label, count: g.counts.enquiries, share: rate(g.counts.enquiries, total), enrolled: g.counts.enrolled, enquiryToEnrolment: g.enquiryToEnrolment }))
    .sort((a, b) => b.count - a.count);
}

export function fmtDelta(d: Delta | null, kind: "count" | "fraction" | "days" = "count"): string {
  if (!d) return "no comparison";
  if (d.direction === "flat") return "no change";
  const sign = d.direction === "up" ? "+" : "−";
  const abs = Math.abs(d.abs);
  if (kind === "fraction") return `${sign}${Math.round(abs * 100)} pts`;
  if (kind === "days") return `${sign}${abs.toFixed(1)}d`;
  return d.pct === null ? `${sign}${abs}` : `${sign}${Math.round(Math.abs(d.pct) * 100)}% (${sign}${abs})`;
}
