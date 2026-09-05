import { describe, expect, it } from "vitest";
import { TemplateRenderError } from "@/lib/email/render";
import { formatMoney, parseMoneyToMinor } from "@/lib/money";
import { buildOfferVariables, feeSnapshotFrom, renderOffer, snapshotFees } from "@/lib/offers/snapshot";
import type { FeeLineRow } from "@/lib/supabase/types";

const lines: FeeLineRow[] = [
  { id: "l2", schedule_id: "s", code: "tuition_annual", label: "Annual tuition", amount_minor: 4_800_000, payable_at_acceptance: false, position: 2 },
  { id: "l1", schedule_id: "s", code: "registration", label: "Registration fee", amount_minor: 250_000, payable_at_acceptance: true, position: 0 },
  { id: "l3", schedule_id: "s", code: "admission", label: "Admission fee", amount_minor: 500_000, payable_at_acceptance: true, position: 1 },
];

// Only the fields the variable builder reads; the graph type is wider.
const graph = {
  application: { child_first_name: "Naledi", child_last_name: "Moeti", reference: "HBS-2026-00012" },
  contact: { first_name: "Kago", last_name: "Moeti" },
  campus: { name: "Block 7", currency: "BWP" },
  grade: { name: "Stage 4" },
  intake: { label: "Term 1, 2027", starts_on: "2027-01-11" },
} as unknown as Parameters<typeof buildOfferVariables>[0];

describe("fee snapshot", () => {
  it("orders lines by position and totals payable-on-acceptance separately", () => {
    const snap = snapshotFees({ currency: "BWP" }, lines);
    expect(snap.lines.map((l) => l.code)).toEqual(["registration", "admission", "tuition_annual"]);
    expect(snap.total_minor).toBe(5_550_000);
    expect(snap.payable_at_acceptance_minor).toBe(750_000);
  });

  it("reads a stored snapshot back and treats the empty placeholder as none", () => {
    const snap = snapshotFees({ currency: "ZAR" }, lines);
    expect(feeSnapshotFrom(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    expect(feeSnapshotFrom({})).toBeNull();
    expect(feeSnapshotFrom(null)).toBeNull();
  });
});

describe("offer variables", () => {
  it("fills fee variables from the snapshot in the schedule's currency", () => {
    const vars = buildOfferVariables(graph, snapshotFees({ currency: "BWP" }, lines), { expiresAt: new Date("2026-10-01T00:00:00Z"), conditions: null });
    expect(vars.registration_fee).toBe("P 2,500.00");
    expect(vars.admission_fee).toBe("P 5,000.00");
    expect(vars.tuition_annual).toBe("P 48,000.00");
    expect(vars.tuition_term).toBeNull();
    expect(vars.amount_due).toBe("P 7,500.00");
    expect(vars.currency).toBe("BWP");
    expect(vars.student_first_name).toBe("Naledi");
    expect(vars.offer_expiry_date).toContain("2026");
  });

  it("leaves fee variables empty when there is no schedule, keeping the campus currency", () => {
    const vars = buildOfferVariables(graph, null, { expiresAt: null, conditions: "Subject to the transfer report" });
    expect(vars.amount_due).toBeNull();
    expect(vars.registration_fee).toBeNull();
    expect(vars.offer_expiry_date).toBeNull();
    expect(vars.currency).toBe("BWP");
    expect(vars.conditions).toBe("Subject to the transfer report");
  });
});

describe("offer rendering", () => {
  const allowed = ["student_first_name", "amount_due", "conditions"];

  it("renders body and terms through the allow-listed renderer", () => {
    const out = renderOffer(
      { body_html: "<p>Dear parent of {{student_first_name}}</p>{{#if conditions}}<p>{{conditions}}</p>{{/if}}", terms_html: "<p>Pay {{amount_due}}.</p>", allowed_variables: allowed },
      { student_first_name: "Naledi", amount_due: "P 7,500.00", conditions: null }
    );
    expect(out.html).toBe("<p>Dear parent of Naledi</p>");
    expect(out.terms).toBe("<p>Pay P 7,500.00.</p>");
  });

  it("refuses a template that names a variable outside its allow-list", () => {
    expect(() =>
      renderOffer({ body_html: "<p>{{parent_email}}</p>", terms_html: "", allowed_variables: allowed }, { parent_email: "x@y" })
    ).toThrow(TemplateRenderError);
  });
});

describe("money", () => {
  it("formats minor units with the currency symbol", () => {
    expect(formatMoney(250_000, "BWP")).toBe("P 2,500.00");
    expect(formatMoney(123_456, "ZAR")).toBe("R 1,234.56");
    expect(formatMoney(5, "BWP")).toBe("P 0.05");
    expect(formatMoney(123_456_789, "BWP")).toBe("P 1,234,567.89");
  });

  it("parses staff input to minor units and rejects junk", () => {
    expect(parseMoneyToMinor("2,500")).toBe(250_000);
    expect(parseMoneyToMinor("2 500.50")).toBe(250_050);
    expect(parseMoneyToMinor("2500,50")).toBe(250_050);
    expect(parseMoneyToMinor("P 48000.50")).toBe(4_800_050);
    expect(parseMoneyToMinor("12.345")).toBeNull();
    expect(parseMoneyToMinor("abc")).toBeNull();
    expect(parseMoneyToMinor("")).toBeNull();
  });
});
