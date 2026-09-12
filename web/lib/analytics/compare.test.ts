import { describe, expect, it } from "vitest";
import { cycleTimes, funnelCounts, groupBy, type FactRow } from "@/lib/analytics/breakdown";
import { deferredSummary, delta, fmtDelta, funnelStages, headline, previousRange, shares } from "@/lib/analytics/compare";

function row(over: Partial<FactRow>): FactRow {
  return {
    application_id: Math.random().toString(36).slice(2), campus_id: "c1", campus_name: "Block 7", grade_id: "g4", grade_name: "Stage 4", grade_sort: 40,
    intake_id: "i1", intake_label: "Term 1 2027", entry_route: "assessment", source: "website", requires_assessment: true, status: "new_enquiry",
    enquired_at: "2026-08-03T09:00:00Z", booked_at: null, attended_at: null, no_show_at: null, assessed_at: null, decided_at: null, offered_at: null,
    accepted_at: null, paid_at: null, enrolled_at: null, withdrawn_at: null, decision_outcome: null, offer_status: null, paid_minor: 0, emails_sent: 0,
    messages_sent: 0, no_show_count: 0, prefilled_count: 0, prefill_changed_count: 0, registration_submitted: false, heard_from: null, promotion_code: null, promotion_name: null, deferred_until: null, withdrawn_reason_code: null,
    ...over,
  };
}

describe("comparison", () => {
  it("finds the period of the same length just before", () => {
    expect(previousRange("2026-08-01", "2026-08-31")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(previousRange("2026-09-07", "2026-09-07")).toEqual({ from: "2026-09-06", to: "2026-09-06" });
  });
  it("describes a change in counts, points and days", () => {
    expect(fmtDelta(delta(120, 100))).toBe("+20% (+20)");
    expect(fmtDelta(delta(80, 100))).toBe("−20% (−20)");
    expect(fmtDelta(delta(5, 0))).toBe("+5");
    expect(fmtDelta(delta(0.35, 0.3, "fraction"), "fraction")).toBe("+5 pts");
    expect(fmtDelta(delta(4.5, 6, "days"), "days")).toBe("−1.5d");
    expect(fmtDelta(delta(3, 3))).toBe("no change");
    expect(fmtDelta(delta(null, 3))).toBe("no comparison");
  });
  it("draws the funnel with share of enquiries and step conversion", () => {
    const rows = [
      row({ booked_at: "2026-08-04T00:00:00Z", attended_at: "2026-08-10T00:00:00Z", assessed_at: "2026-08-10T00:00:00Z", decided_at: "2026-08-11T00:00:00Z", decision_outcome: "approved", offered_at: "2026-08-12T00:00:00Z", accepted_at: "2026-08-13T00:00:00Z", paid_at: "2026-08-14T00:00:00Z", enrolled_at: "2026-08-20T00:00:00Z", status: "enrolled" }),
      row({ booked_at: "2026-08-04T00:00:00Z", no_show_at: "2026-08-10T00:00:00Z", status: "no_show" }),
      row({}),
      row({}),
    ];
    const stages = funnelStages(funnelCounts(rows));
    expect(stages[0]).toMatchObject({ key: "enquiries", count: 4, ofTop: 1, step: null });
    expect(stages[1]).toMatchObject({ key: "bookings", count: 2, ofTop: 0.5, step: 0.5 });
    expect(stages[2]).toMatchObject({ key: "attended", count: 1, step: 0.5 });
    expect(stages[8]).toMatchObject({ key: "enrolled", count: 1, ofTop: 0.25, step: 1 });
    const h = headline(rows);
    expect(h.enquiries).toBe(4);
    expect(h.enrolled).toBe(1);
    expect(h.noShowRate).toBe(0.5);
    expect(h.enquiryToEnrolment).toBe(0.25);
  });
  it("turns a breakdown into shares, largest first", () => {
    const rows = [row({ campus_id: "a", campus_name: "A" }), row({ campus_id: "b", campus_name: "B" }), row({ campus_id: "b", campus_name: "B" })];
    const s = shares(groupBy(rows, "campus"));
    expect(s.map((x) => x.label)).toEqual(["B", "A"]);
    expect(s[0].share).toBeCloseTo(2 / 3);
  });
});

describe("deferred, beside the funnel", () => {
  it("counts the paused and how many are due back inside the horizon", () => {
    const rows = [
      row({ status: "deferred", deferred_until: "2026-10-01" }),
      row({ status: "deferred", deferred_until: "2027-03-01" }),
      // A deferral with no date counts as paused but never as due: "soon" is
      // exactly what an absent date does not say.
      row({ status: "deferred", deferred_until: null }),
      row({ status: "enrolled" }),
    ];
    expect(deferredSummary(rows, "2026-12-31")).toEqual({ count: 3, dueWithin: 1, horizon: "2026-12-31" });
  });

  it("keeps them out of the funnel entirely", () => {
    const stages = funnelStages(funnelCounts([row({ status: "deferred", deferred_until: "2026-10-01" })]));
    expect(stages.map((s) => s.key)).not.toContain("deferred");
  });

  it("leaves the cycle-time medians alone", () => {
    // A six-month pause would otherwise move "days to decision" for everybody.
    const quick = row({ status: "declined", enquired_at: "2026-08-01T00:00:00Z", assessed_at: "2026-08-01T00:00:00Z", decided_at: "2026-08-03T00:00:00Z" });
    const paused = row({ status: "deferred", enquired_at: "2026-08-01T00:00:00Z", assessed_at: "2026-08-01T00:00:00Z", decided_at: "2027-02-01T00:00:00Z" });
    expect(cycleTimes([quick, paused]).assessmentToDecision).toBe(2);
  });

  it("groups withdrawals by reason, naming the ones with no code", () => {
    const groups = groupBy(
      [
        row({ status: "withdrawn", withdrawn_reason_code: "fees" }),
        row({ status: "withdrawn", withdrawn_reason_code: "fees" }),
        row({ status: "withdrawn", withdrawn_reason_code: "another_school" }),
        row({ status: "withdrawn", withdrawn_reason_code: null }),
        row({ status: "enrolled" }),
      ],
      "withdrawn_reason"
    );
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.counts.enquiries]));
    expect(byKey).toEqual({ fees: 2, another_school: 1, "not recorded": 1, "still applying": 1 });
    // Coded reasons first, then the unrecorded, then everybody else.
    expect(groups.map((g) => g.key)).toEqual(["another_school", "fees", "not recorded", "still applying"]);
  });
});
