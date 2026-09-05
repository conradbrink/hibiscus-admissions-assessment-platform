import { describe, expect, it } from "vitest";
import { breakdownCsvRows, conversion, cycleTimes, funnelCounts, groupBy, median, parentEffort, weekKey, weeklySeries, type FactRow } from "@/lib/analytics/breakdown";
import { DEFAULT_RATES, forecast, historicalRates, MIN_SAMPLE, stageOf } from "@/lib/analytics/forecast";

function row(over: Partial<FactRow>): FactRow {
  return {
    application_id: over.application_id ?? Math.random().toString(36).slice(2),
    campus_id: "c1",
    campus_name: "Block 7",
    grade_id: "g4",
    grade_name: "Stage 4",
    grade_sort: 40,
    intake_id: "i1",
    intake_label: "Term 1 2027",
    entry_route: "assessment",
    source: "website",
    requires_assessment: true,
    status: "new_enquiry",
    enquired_at: "2026-08-03T09:00:00Z",
    booked_at: null,
    attended_at: null,
    no_show_at: null,
    assessed_at: null,
    decided_at: null,
    offered_at: null,
    accepted_at: null,
    paid_at: null,
    enrolled_at: null,
    withdrawn_at: null,
    decision_outcome: null,
    offer_status: null,
    paid_minor: 0,
    emails_sent: 2,
    messages_sent: 0,
    no_show_count: 0,
    prefilled_count: 0,
    prefill_changed_count: 0,
    registration_submitted: false,
    ...over,
  };
}

const enrolled = row({
  status: "enrolled",
  booked_at: "2026-08-04T09:00:00Z",
  attended_at: "2026-08-10T08:00:00Z",
  assessed_at: "2026-08-10T09:00:00Z",
  decided_at: "2026-08-12T09:00:00Z",
  offered_at: "2026-08-13T09:00:00Z",
  accepted_at: "2026-08-15T09:00:00Z",
  paid_at: "2026-08-20T09:00:00Z",
  enrolled_at: "2026-08-25T09:00:00Z",
  decision_outcome: "approved",
  emails_sent: 9,
  messages_sent: 3,
  prefilled_count: 10,
  prefill_changed_count: 2,
  registration_submitted: true,
});
const noShow = row({ status: "no_show", booked_at: "2026-08-05T09:00:00Z", no_show_at: "2026-08-11T09:00:00Z", no_show_count: 1, source: "phone" });
const preschool = row({ requires_assessment: false, status: "awaiting_decision", grade_id: "g1", grade_name: "Nursery", grade_sort: 10, enquired_at: "2026-08-12T09:00:00Z" });
const declined = row({ status: "declined", booked_at: "2026-08-05T09:00:00Z", attended_at: "2026-08-11T09:00:00Z", assessed_at: "2026-08-11T10:00:00Z", decided_at: "2026-08-12T09:00:00Z", decision_outcome: "declined" });

describe("funnel", () => {
  const rows = [enrolled, noShow, preschool, declined];
  it("counts each stage and only counts assessment stages for assessed applicants", () => {
    const c = funnelCounts(rows);
    expect(c).toMatchObject({ enquiries: 4, bookings: 3, attended: 2, noShows: 1, completed: 2, decided: 2, approved: 1, declined: 1, offered: 1, accepted: 1, paid: 1, enrolled: 1, withdrawn: 0 });
  });
  it("converts and gives null where nothing can be divided", () => {
    const c = conversion(funnelCounts(rows), 3);
    expect(c.enquiryToBooking).toBe(1);
    expect(c.paymentToEnrolment).toBe(1);
    expect(conversion(funnelCounts([]), 0).enquiryToBooking).toBeNull();
  });
  it("takes medians of cycle days", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const t = cycleTimes(rows);
    expect(t.enquiryToBooking).toBe(2);
    expect(t.paymentToEnrolment).toBe(5);
  });
  it("groups by campus, grade, week, source and outcome", () => {
    expect(groupBy(rows, "grade").map((g) => g.label)).toEqual(["Nursery", "Stage 4"]);
    expect(groupBy(rows, "source").map((g) => [g.label, g.counts.enquiries])).toEqual([["phone", 1], ["website", 3]]);
    expect(groupBy(rows, "outcome").map((g) => g.label)).toEqual(["approved", "declined", "not decided"]);
    expect(weekKey("2026-08-05T09:00:00Z")).toBe("2026-08-03");
    expect(groupBy(rows, "week").map((g) => g.key)).toEqual(["2026-08-03", "2026-08-10"]);
  });
  it("builds a continuous weekly series", () => {
    const s = weeklySeries(rows, "2026-08-01", "2026-08-31");
    expect(s.map((w) => w.week)).toEqual(["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
    expect(s[1]).toEqual({ week: "2026-08-03", enquiries: 3, enrolments: 0 });
    expect(s[4]).toEqual({ week: "2026-08-24", enquiries: 0, enrolments: 1 });
  });
  it("measures parent effort", () => {
    const e = parentEffort(rows, 8);
    expect(e.fieldsBeforeAssessment).toBe(8);
    expect(e.staffAssisted).toBe(0.25);
    expect(e.prefilledAtRegistration).toBe(0.8);
    expect(e.messagesPerApplicant).toBe(4.5);
    expect(e.bookingAbandonment).toBe(0);
  });
  it("renders the breakdown as CSV rows", () => {
    const { headers, rows: out } = breakdownCsvRows("grade", groupBy(rows, "grade"));
    expect(headers[0]).toBe("Grade");
    expect(out[1][0]).toBe("Stage 4");
    expect(out[1][headers.length - 1]).toBe("33.3");
  });
});

describe("forecast", () => {
  it("coarsens statuses to stages", () => {
    expect(stageOf(row({ status: "offer_sent" }))).toBe("offered");
    expect(stageOf(row({ status: "waitlisted" }))).toBe("closed");
    expect(stageOf(row({ status: "no_show", booked_at: "x" }))).toBe("booked");
    expect(stageOf(row({ status: "new_enquiry" }))).toBe("enquired");
  });
  it("uses history when there is enough of it and defaults otherwise", () => {
    const thin = historicalRates([enrolled, declined]);
    expect(thin.enquired).toMatchObject({ source: "default", rate: DEFAULT_RATES.enquired, sample: 2 });
    const many = [...Array(MIN_SAMPLE)].map((_, i) => (i % 2 ? enrolled : declined));
    const r = historicalRates(many);
    expect(r.enquired).toMatchObject({ source: "history", rate: 0.5, sample: MIN_SAMPLE });
    expect(r.offered).toMatchObject({ source: "default" });
  });
  it("expects enrolments from the pipeline and shows the shortfall against capacity", () => {
    const rates = historicalRates([]);
    const current = [row({ status: "enrolled", enrolled_at: "x" }), row({ status: "offer_sent" }), row({ status: "new_enquiry" }), row({ status: "withdrawn" })];
    const lines = forecast(current, rates, [{ campus_id: "c1", grade_id: "g4", capacity: 10, campus_name: "Block 7", grade_name: "Stage 4", grade_sort: 40 }]);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.committed).toBe(2);
    expect(l.pipeline).toEqual({ enrolled: 1, offered: 1, enquired: 1 });
    expect(l.expected).toBe(2.1);
    expect(l.remaining).toBe(8);
    expect(l.fill).toBeCloseTo(0.21, 2);
    expect(l.enquiriesNeeded).toBe(Math.ceil((10 - 2.1) / 0.3));
    expect(l.lowConfidence).toBe(true);
  });
  it("treats no capacity as unlimited", () => {
    const l = forecast([row({ status: "paid" })], historicalRates([]), [{ campus_id: "c1", grade_id: "g4", capacity: null, campus_name: "B", grade_name: "S", grade_sort: 1 }])[0];
    expect(l.fill).toBeNull();
    expect(l.remaining).toBeNull();
    expect(l.enquiriesNeeded).toBeNull();
  });
});
