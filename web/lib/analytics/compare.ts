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

/**
 * The change from `previous` to `current`; percentages compare as points, counts as a ratio.
 *
 * Percentages are shown whole, so they are compared as shown: 86.5% and 87.3%
 * both read "87%", and a "+1 pt" between two equal figures would contradict
 * the screen it sits on.
 */
export function delta(current: number | null, previous: number | null, kind: "count" | "fraction" | "days" = "count"): Delta | null {
  if (current === null || previous === null) return null;
  const abs = kind === "fraction" ? (Math.round(current * 100) - Math.round(previous * 100)) / 100 : current - previous;
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

export type DeferredSummary = { count: number; dueWithin: number; horizon: string };

/**
 * The families who paused, shown beside the funnel rather than in it.
 *
 * The funnel is a path and this is a pause: putting deferrals in as a stage
 * would say families passed through them on the way to enrolling, which is
 * the opposite of what happened. What the school wants when planning an
 * intake is the pair of numbers — how many are paused, and how many are due
 * back soon enough to matter for this one.
 *
 * `horizon` is a date; anything due on or before it counts as due back.
 * A deferral with no date counts in the total and not in the due, because
 * "soon" is exactly what it does not say.
 */
export function deferredSummary(rows: FactRow[], horizon: string): DeferredSummary {
  const deferred = rows.filter((r) => r.status === "deferred");
  return {
    count: deferred.length,
    dueWithin: deferred.filter((r) => r.deferred_until !== null && r.deferred_until <= horizon).length,
    horizon,
  };
}

export type Share = { key: string; label: string; count: number; share: number | null; enrolled: number; enquiryToEnrolment: number | null };

/** A breakdown as shares of the whole, largest first. */
export function shares(groups: Breakdown[]): Share[] {
  const total = groups.reduce((n, g) => n + g.counts.enquiries, 0);
  return groups
    .map((g) => ({ key: g.key, label: g.label, count: g.counts.enquiries, share: rate(g.counts.enquiries, total), enrolled: g.counts.enrolled, enquiryToEnrolment: g.enquiryToEnrolment }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The direction of a change as it reads once rounded for display.
 *
 * A median that moved by 0.02 days is "down" to the arithmetic and "−0.0d" on
 * the screen, which looks like a fault and says nothing. Whatever rounds to
 * zero is no change, so the colour and the words agree.
 */
export function shownDirection(d: Delta | null, kind: "count" | "fraction" | "days" = "count"): Delta["direction"] | null {
  if (!d) return null;
  const abs = Math.abs(d.abs);
  const shown = kind === "fraction" ? Math.round(abs * 100) : kind === "days" ? Number(abs.toFixed(1)) : abs;
  return shown === 0 ? "flat" : d.direction;
}

export function fmtDelta(d: Delta | null, kind: "count" | "fraction" | "days" = "count"): string {
  if (!d) return "no comparison";
  if (shownDirection(d, kind) === "flat") return "no change";
  const sign = d.direction === "up" ? "+" : "−";
  const abs = Math.abs(d.abs);
  if (kind === "fraction") {
    const points = Math.round(abs * 100);
    return `${sign}${points} ${points === 1 ? "pt" : "pts"}`;
  }
  if (kind === "days") return `${sign}${abs.toFixed(1)}d`;
  return d.pct === null ? `${sign}${abs}` : `${sign}${Math.round(Math.abs(d.pct) * 100)}% (${sign}${abs})`;
}

export type ConversionStepKey =
  | "enquiryToBooking"
  | "bookingToAttendance"
  | "approvalRate"
  | "offerToAcceptance"
  | "acceptanceToPayment"
  | "paymentToEnrolment";

export type ConversionStep = {
  key: ConversionStepKey;
  label: string;
  /** The funnel stage this step leads into, so the funnel can point at the same place. */
  stage: FunnelStage["key"];
  /** Families who could take the step: the denominator of `rate`. */
  from: number;
  rate: number | null;
  previous: number | null;
  /** The school's own decision rather than a family's, so never called a loss. */
  chosenBySchool: boolean;
};

/**
 * The step-to-step conversions the specification names, this period and the
 * one before, with how many families each step started from. The rates are
 * `conversion()`'s own; this only puts them in the order they are read.
 * `before` is null when the period before could not be read: no comparison,
 * rather than a comparison with nothing.
 */
export function conversionSteps(now: FunnelCounts, nowAssessed: number, before: FunnelCounts | null, beforeAssessed: number): ConversionStep[] {
  const cur = conversion(now, nowAssessed);
  const prev = before ? conversion(before, beforeAssessed) : null;
  const steps: Array<[ConversionStepKey, string, FunnelStage["key"], number]> = [
    ["enquiryToBooking", "Enquiry → booking", "bookings", nowAssessed],
    ["bookingToAttendance", "Booking → attended", "attended", now.bookings],
    ["approvalRate", "Decisions approved", "approved", now.decided],
    ["offerToAcceptance", "Offer → accepted", "accepted", now.offered],
    ["acceptanceToPayment", "Accepted → paid", "paid", now.accepted],
    ["paymentToEnrolment", "Paid → enrolled", "enrolled", now.paid],
  ];
  return steps.map(([key, label, stage, from]) => ({ key, label, stage, from, rate: cur[key], previous: prev ? prev[key] : null, chosenBySchool: key === "approvalRate" }));
}

/**
 * The step with the lowest conversion: the one the page marks as weakest.
 *
 * By rate rather than by families lost, because the steps nearest the top
 * always lose the most families simply by being the biggest, and "the top of
 * the funnel" is not news. A step that fewer than `minFamilies` could take is
 * left out: two families paid and neither has enrolled yet is 0%, and calling
 * that the weakest point in admissions would be noise rather than a finding.
 * A step the school chooses (approving a decision) is never a candidate:
 * a selective campus declining a family has not lost an applicant. A tie
 * goes to the earlier step, where the families are lost first.
 */
export function weakestStep(steps: ReadonlyArray<Pick<ConversionStep, "key" | "from" | "rate"> & { chosenBySchool?: boolean }>, minFamilies = 5): ConversionStepKey | null {
  let weakest: { key: ConversionStepKey; rate: number } | null = null;
  for (const s of steps) {
    if (s.rate === null || s.from < minFamilies || s.chosenBySchool) continue;
    if (!weakest || s.rate < weakest.rate) weakest = { key: s.key, rate: s.rate };
  }
  return weakest?.key ?? null;
}
