import { describe, expect, it } from "vitest";
import { summaryFacts, type SummaryInputs } from "@/lib/summary/facts";
import { fallbackSummary, inputHash, SUMMARY_SCHEMA, validateSummary } from "@/lib/summary/narrative";

const now = new Date("2026-09-05T10:00:00Z");

function inputs(overrides: Partial<SummaryInputs> = {}): SummaryInputs {
  return {
    now,
    application: { status: "offer_sent", next_action: "accept_offer", next_action_due_at: "2026-09-07T00:00:00Z", created_at: "2026-08-01T09:00:00Z", child_first_name: "Thato", requires_assessment: true, entry_route: "assessment", source: "website" },
    campus: "Block 7",
    grade: "Stage 4",
    intake: "Term 1 2027",
    events: [
      { type: "booking.created", occurred_at: "2026-08-01T09:05:00Z", summary: "" },
      { type: "booking.checked_in", occurred_at: "2026-08-10T08:00:00Z", summary: "" },
      { type: "assessment.completed", occurred_at: "2026-08-10T09:00:00Z", summary: "" },
      { type: "decision.made", occurred_at: "2026-08-12T09:00:00Z", summary: "" },
      { type: "offer.sent", occurred_at: "2026-09-03T09:00:00Z", summary: "" },
    ],
    booking: null,
    attempt: { status: "submitted", marking_status: "complete", submitted_at: "2026-08-10T09:00:00Z" },
    decision: { final_outcome: "approved", decided_by: "rules", decided_at: "2026-08-12T09:00:00Z", override_reason: null },
    offer: { status: "sent", expires_at: "2026-09-07T00:00:00Z", sent_at: "2026-09-03T09:00:00Z" },
    paymentRequest: null,
    registration: null,
    openTasks: [],
    emailsSent: 4,
    messagesSent: 1,
    lastInboundMessageAt: null,
    siblings: [],
    ...overrides,
  };
}

describe("summaryFacts", () => {
  it("tells the story in order and flags an offer expiring within three days", () => {
    const { facts, flags } = summaryFacts(inputs());
    expect(facts[0]).toContain("Thato: Stage 4 at Block 7");
    expect(facts).toContain("Assessment booked on 2026-08-01.");
    expect(facts).toContain("Offer sent on 2026-09-03.");
    expect(facts).toContain("Status: Offer sent.");
    expect(flags.map((f) => f.kind)).toEqual(["offer_expiring"]);
  });
  it("flags overdue payment, missing documents, mismatches, overdue tasks, a reply and siblings", () => {
    const { flags } = summaryFacts(
      inputs({
        application: { ...inputs().application, status: "registration_incomplete" },
        offer: null,
        paymentRequest: { status: "partially_paid", due_at: "2026-09-01T00:00:00Z", amount_minor: 500000, paid_minor: 100000, currency: "BWP" },
        registration: { submitted_at: null, prefill_changed: ["child_date_of_birth"], mismatch_count: 1, sections_done: 3, sections_total: 6, missing_documents: ["Birth certificate"], rejected_documents: [] },
        openTasks: [
          { type: "documents_missing", title: "Thato: documents still needed", due_at: "2026-09-01T00:00:00Z", priority: "normal" },
          { type: "parent_replied", title: "Sarah replied", due_at: null, priority: "normal" },
        ],
        siblings: [{ child_first_name: "Neo", status: "enrolled" }],
      })
    );
    expect(flags.map((f) => f.kind).sort()).toEqual(
      ["document_mismatch", "missing_documents", "overdue_task", "parent_replied", "payment_overdue", "registration_changed_identity", "sibling_applying"].sort()
    );
    expect(flags.find((f) => f.kind === "payment_overdue")?.evidence).toBe("BWP 4000.00 outstanding since 2026-09-01");
  });
  it("flags a stalled application and repeated no-shows, but not a terminal one", () => {
    const stalled = summaryFacts(inputs({ application: { ...inputs().application, status: "no_show" }, offer: null, events: [{ type: "booking.no_show", occurred_at: "2026-07-01T00:00:00Z", summary: "" }, { type: "booking.no_show", occurred_at: "2026-08-01T00:00:00Z", summary: "" }] }));
    expect(stalled.flags.map((f) => f.kind)).toEqual(["no_show_repeat", "stalled"]);
    const done = summaryFacts(inputs({ application: { ...inputs().application, status: "enrolled" }, offer: null, events: [{ type: "enrolment.completed", occurred_at: "2026-07-01T00:00:00Z", summary: "" }] }));
    expect(done.flags).toEqual([]);
  });
  it("names what is waiting on the school", () => {
    const { flags } = summaryFacts(inputs({ application: { ...inputs().application, status: "staff_review" }, offer: null }));
    expect(flags.map((f) => f.kind)).toEqual(["waiting_on_school"]);
  });
});

describe("summary prose", () => {
  const { facts, flags } = summaryFacts(inputs());
  it("falls back to the facts and satisfies the schema", () => {
    const prose = fallbackSummary(facts, flags);
    expect(SUMMARY_SCHEMA.safeParse(prose).success).toBe(true);
    expect(prose.paragraph).toContain("To follow up: offer expiring.");
    expect(validateSummary(prose, facts)).toEqual([]);
  });
  it("rejects a number that is not in the facts and a judgement of the child", () => {
    expect(validateSummary({ headline: "Offer sent; 19 days to accept.", paragraph: "The application is at the offer stage and the family has until 2026-09-07 to accept." }, facts).map((p) => p.kind)).toEqual(["number"]);
    expect(validateSummary({ headline: "A gifted child with an offer in hand.", paragraph: "Offer sent on 2026-09-03; the family have until 2026-09-07 to accept it." }, facts).map((p) => p.kind)).toEqual(["term"]);
  });
  it("hashes the same inputs to the same value and different evidence differently", () => {
    expect(inputHash(facts, flags)).toBe(inputHash([...facts], [...flags]));
    expect(inputHash(facts, [])).not.toBe(inputHash(facts, flags));
  });
});
