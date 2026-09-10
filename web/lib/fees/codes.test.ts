import { describe, expect, it } from "vitest";
import {
  availableCodes,
  canonicalPosition,
  FEE_CODES,
  feeDefaults,
  isFeeCode,
  parseNewLine,
  parseSubmittedLines,
  scheduleTotals,
} from "./codes";

/** A stand-in for FormData: the parsers only ever read fields by name. */
const form = (fields: Record<string, string>) => ({
  get: (name: string) => (name in fields ? fields[name] : null),
});

describe("the vocabulary", () => {
  it("is the six codes the database allows", () => {
    // Kept in step with the check constraint on fee_lines.code, widened by
    // 20260909210000_tuition_per_month.sql and 20260910160000_bana_tlokweng.sql.
    expect([...FEE_CODES].sort()).toEqual(
      ["admission", "registration", "stationery_annual", "tuition_annual", "tuition_month", "tuition_term"].sort()
    );
  });

  it("knows what is a fee code and what is not", () => {
    expect(isFeeCode("admission")).toBe(true);
    expect(isFeeCode("stationery_annual")).toBe(true);
    expect(isFeeCode("uniform")).toBe(false);
    expect(isFeeCode(null)).toBe(false);
  });

  it("puts what holds the place before what pays for the year", () => {
    expect(canonicalPosition("registration")).toBeLessThan(canonicalPosition("admission"));
    expect(canonicalPosition("admission")).toBeLessThan(canonicalPosition("tuition_month"));
  });

  it("charges the application and admission fees at acceptance, and nothing else", () => {
    const upfront = FEE_CODES.filter((c) => feeDefaults(c).payableAtAcceptance);
    expect(upfront).toEqual(["registration", "admission"]);
  });
});

describe("availableCodes", () => {
  it("offers only what the schedule does not already have", () => {
    expect(availableCodes(["registration", "admission"])).toEqual([
      "tuition_month",
      "tuition_term",
      "tuition_annual",
      "stationery_annual",
    ]);
  });

  it("offers nothing once every fee is on the schedule", () => {
    expect(availableCodes([...FEE_CODES])).toEqual([]);
  });
});

describe("parseSubmittedLines", () => {
  it("writes only the lines the card rendered", () => {
    // The regression that matters. Phase 4 · Pre-school carries one fee. The
    // old save iterated the whole vocabulary and inserted four zero-amount
    // lines, which would have printed on the parent's offer letter.
    const { keep, remove } = parseSubmittedLines(
      form({ label_registration: "Application fee", amount_registration: "300.00", payable_registration: "1" }),
      ["registration"]
    );
    expect(keep).toHaveLength(1);
    expect(keep[0]).toMatchObject({ code: "registration", label: "Application fee", amount_minor: 30000, payable_at_acceptance: true });
    expect(remove).toEqual([]);
  });

  it("saves a stationery line rather than dropping it", () => {
    // stationery_annual was in the database but in none of the code lists,
    // so the field rendered and the edit went nowhere.
    const { keep } = parseSubmittedLines(
      form({ label_stationery_annual: "Annual stationery", amount_stationery_annual: "2,500" }),
      ["stationery_annual"]
    );
    expect(keep[0]).toMatchObject({ code: "stationery_annual", amount_minor: 250000, payable_at_acceptance: false });
  });

  it("separates the lines marked for removal", () => {
    const { keep, remove } = parseSubmittedLines(
      form({ amount_registration: "300", amount_admission: "2000", remove_admission: "1" }),
      ["registration", "admission"]
    );
    expect(keep.map((l) => l.code)).toEqual(["registration"]);
    expect(remove).toEqual(["admission"]);
  });

  it("falls back to the standard label rather than storing the bare code", () => {
    const { keep } = parseSubmittedLines(form({ label_admission: "   ", amount_admission: "2000" }), ["admission"]);
    expect(keep[0].label).toBe("Admission fee");
  });

  it("treats a blank amount as zero, and refuses a nonsense one", () => {
    expect(parseSubmittedLines(form({ amount_admission: "" }), ["admission"]).keep[0].amount_minor).toBe(0);
    expect(() => parseSubmittedLines(form({ amount_admission: "lots" }), ["admission"])).toThrow(/not an amount/);
    expect(() => parseSubmittedLines(form({ amount_admission: "-5" }), ["admission"])).toThrow(/not an amount/);
  });

  it("refuses a code that is not in the vocabulary", () => {
    expect(() => parseSubmittedLines(form({}), ["uniform"])).toThrow(/not a fee we know about/);
  });
});

describe("parseNewLine", () => {
  it("is null when no fee was chosen", () => {
    expect(parseNewLine(form({ newCode: "" }), [])).toBeNull();
    expect(parseNewLine(form({}), [])).toBeNull();
  });

  it("takes the standard label and due point when only an amount is given", () => {
    expect(parseNewLine(form({ newCode: "admission", newAmount: "2000" }), ["registration"])).toMatchObject({
      code: "admission",
      label: "Admission fee",
      amount_minor: 200000,
      payable_at_acceptance: false,
    });
  });

  it("refuses a second fee of a kind the schedule already has", () => {
    // fee_lines is unique on (schedule_id, code); this is the friendly half.
    expect(() => parseNewLine(form({ newCode: "admission" }), ["admission"])).toThrow(/already has/);
  });

  it("refuses a code that is not in the vocabulary", () => {
    expect(() => parseNewLine(form({ newCode: "uniform" }), [])).toThrow(/not a fee we know about/);
  });
});

describe("scheduleTotals", () => {
  it("adds everything, and separately what is due to hold the place", () => {
    expect(
      scheduleTotals([
        { amount_minor: 30000, payable_at_acceptance: true },
        { amount_minor: 200000, payable_at_acceptance: true },
        { amount_minor: 1700000, payable_at_acceptance: false },
      ])
    ).toEqual({ total: 1930000, atAcceptance: 230000 });
  });

  it("counts a schedule with no fees as nothing rather than as broken", () => {
    expect(scheduleTotals([])).toEqual({ total: 0, atAcceptance: 0 });
  });

  it("copes with the bigint amounts PostgREST returns as strings", () => {
    expect(scheduleTotals([{ amount_minor: "159000", payable_at_acceptance: false }])).toEqual({
      total: 159000,
      atAcceptance: 0,
    });
  });
});
