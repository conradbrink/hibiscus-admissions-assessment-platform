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

describe("the tense of a term that has already started", () => {
  // The bug: "We will email you everything you need before Term 3, 2026
  // starts" went to families joining a term that began on 7 September, while
  // it was still being offered on the 10th.
  const on = (today: string, startsOn: string) =>
    buildOfferVariables(
      { ...graph, intake: { label: "Term 3, 2026", starts_on: startsOn } } as typeof graph,
      null,
      { expiresAt: null, conditions: null, now: new Date(`${today}T09:00:00Z`) }
    );

  it("is future tense while the term is still ahead", () => {
    const v = on("2026-09-01", "2026-09-07");
    expect(v.intake_not_started).toBeTruthy();
    expect(v.intake_started).toBeNull();
  });

  it("is past tense once the term has begun", () => {
    const v = on("2026-09-10", "2026-09-07");
    expect(v.intake_not_started).toBeNull();
    expect(v.intake_started).toBeTruthy();
  });

  it("treats the first day of term as started, not as still to come", () => {
    // A letter drafted on the morning of the 7th must not promise to write
    // "before term starts" — term is starting as it is read.
    const v = on("2026-09-07", "2026-09-07");
    expect(v.intake_not_started).toBeNull();
    expect(v.intake_started).toBeTruthy();
  });

  it("reads the date in Gaborone, not UTC", () => {
    // 22:30 UTC on the 6th is already the 7th at school, so the term has
    // started for a letter drafted then.
    const v = buildOfferVariables(
      { ...graph, intake: { label: "Term 3, 2026", starts_on: "2026-09-07" } } as typeof graph,
      null,
      { expiresAt: null, conditions: null, now: new Date("2026-09-06T22:30:00Z") }
    );
    expect(v.intake_started).toBeTruthy();
  });

  it("exactly one of the two is ever set", () => {
    for (const [today, starts] of [["2026-01-01", "2026-09-07"], ["2026-09-07", "2026-09-07"], ["2027-01-01", "2026-09-07"]]) {
      const v = on(today, starts);
      expect(Boolean(v.intake_not_started) !== Boolean(v.intake_started)).toBe(true);
    }
  });
});

describe("half day and full day", () => {
  const preschool: FeeLineRow[] = [
    { id: "a", schedule_id: "s", code: "registration", label: "Application fee", amount_minor: 30_000, payable_at_acceptance: true, position: 1 },
    { id: "b", schedule_id: "s", code: "tuition_term_half", label: "Tuition per term (half day)", amount_minor: 980_000, payable_at_acceptance: false, position: 4 },
    { id: "c", schedule_id: "s", code: "tuition_term_full", label: "Tuition per term (full day)", amount_minor: 1_079_000, payable_at_acceptance: false, position: 5 },
  ];
  const withPattern = (day_pattern: "half" | "full" | null) =>
    buildOfferVariables(
      { ...graph, application: { ...graph.application, day_pattern } } as typeof graph,
      snapshotFees({ currency: "BWP" }, preschool),
      { expiresAt: null, conditions: null }
    );

  it("shows both rates while nobody has said which", () => {
    const v = withPattern(null);
    expect(v.tuition_term_half).toBe(formatMoney(980_000, "BWP"));
    expect(v.tuition_term_full).toBe(formatMoney(1_079_000, "BWP"));
    // And no single figure, so the letter cannot quote one by accident.
    expect(v.tuition_term).toBeNull();
  });

  it("quotes the chosen rate as the term fee once the school has placed the child", () => {
    const full = withPattern("full");
    expect(full.tuition_term).toBe(formatMoney(1_079_000, "BWP"));
    expect(full.tuition_term_half).toBeNull();
    expect(full.tuition_term_full).toBeNull();

    const half = withPattern("half");
    expect(half.tuition_term).toBe(formatMoney(980_000, "BWP"));
  });

  it("never adds tuition to what is due at acceptance", () => {
    // The school was explicit: these are invoiced, not a condition of the
    // place. Only the P300 application fee is payable to accept.
    const snap = snapshotFees({ currency: "BWP" }, preschool);
    expect(snap.payable_at_acceptance_minor).toBe(30_000);
  });

  it("leaves a campus that charges one term rate alone", () => {
    const single: FeeLineRow[] = [
      { id: "d", schedule_id: "s", code: "tuition_term", label: "Tuition per term", amount_minor: 1_700_000, payable_at_acceptance: false, position: 3 },
    ];
    const v = buildOfferVariables(graph, snapshotFees({ currency: "BWP" }, single), { expiresAt: null, conditions: null });
    expect(v.tuition_term).toBe(formatMoney(1_700_000, "BWP"));
    expect(v.tuition_term_half).toBeNull();
  });
});
