import { describe, expect, it } from "vitest";
import { conversion, funnelCounts, type FactRow } from "@/lib/analytics/breakdown";
import { conversionSteps } from "@/lib/analytics/compare";
import { isConversionStepKey, NOT_CONVERTED, notConverted } from "@/lib/analytics/drill-down";

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

const t = "2026-08-05T09:00:00Z";
const ROWS: FactRow[] = [
  row({}),
  row({ requires_assessment: false }),
  row({ status: "withdrawn" }),
  row({ booked_at: t, status: "assessment_booked" }),
  row({ booked_at: t, no_show_at: t, status: "no_show" }),
  row({ booked_at: t, attended_at: t, assessed_at: t, decided_at: t, decision_outcome: "declined", status: "declined" }),
  row({ booked_at: t, attended_at: t, assessed_at: t, decided_at: t, decision_outcome: "waitlisted", status: "waitlisted" }),
  row({ booked_at: t, attended_at: t, assessed_at: t, decided_at: t, decision_outcome: "approved", offered_at: t, status: "offer_sent" }),
  row({ requires_assessment: false, decided_at: t, decision_outcome: "approved", offered_at: t, accepted_at: t, status: "payment_required" }),
  row({ booked_at: t, attended_at: t, assessed_at: t, decided_at: t, decision_outcome: "approved", offered_at: t, accepted_at: t, paid_at: t, status: "registration_incomplete" }),
  row({ booked_at: t, attended_at: t, assessed_at: t, decided_at: t, decision_outcome: "approved", offered_at: t, accepted_at: t, paid_at: t, enrolled_at: t, status: "enrolled" }),
];

describe("the families behind a conversion step", () => {
  it("are the families the step started from, less the ones it converted", () => {
    // The number analytics links from and the list it opens are the same
    // families: this is the whole point of the drill-down.
    const steps = conversionSteps({ counts: funnelCounts(ROWS), assessed: ROWS.filter((r) => r.requires_assessment).length }, null);
    const rates = conversion(funnelCounts(ROWS), ROWS.filter((r) => r.requires_assessment).length);
    for (const s of steps) {
      const converted = Math.round((rates[s.key] ?? 0) * s.from);
      expect(notConverted(ROWS, s.key).length, s.key).toBe(s.from - converted);
    }
  });

  it("counts a withdrawn family as not booked, and a family with no assessment not at all", () => {
    const lost = notConverted(ROWS, "enquiryToBooking");
    expect(lost.map((r) => r.status).sort()).toEqual(["new_enquiry", "withdrawn"]);
  });

  it("keeps the families the school did not approve, not the ones it did", () => {
    expect(notConverted(ROWS, "approvalRate").map((r) => r.status).sort()).toEqual(["declined", "waitlisted"]);
  });

  it("lists the newest enquiry first", () => {
    const rows = [row({ enquired_at: "2026-08-01T09:00:00Z" }), row({ enquired_at: "2026-08-09T09:00:00Z" })];
    expect(notConverted(rows, "enquiryToBooking").map((r) => r.enquired_at)).toEqual(["2026-08-09T09:00:00Z", "2026-08-01T09:00:00Z"]);
  });

  it("breaks a tie in enquiry time by id, so a page holds the same families every read", () => {
    const at = "2026-08-01T09:00:00Z";
    const rows = [row({ application_id: "b", enquired_at: at }), row({ application_id: "a", enquired_at: at })];
    expect(notConverted(rows, "enquiryToBooking").map((r) => r.application_id)).toEqual(["a", "b"]);
    expect(notConverted([...rows].reverse(), "enquiryToBooking").map((r) => r.application_id)).toEqual(["a", "b"]);
  });

  it("recognises only its own step names", () => {
    expect(Object.keys(NOT_CONVERTED).every(isConversionStepKey)).toBe(true);
    expect(isConversionStepKey("toString")).toBe(false);
    expect(isConversionStepKey(undefined)).toBe(false);
  });
});
