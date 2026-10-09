import { z } from "zod";

/**
 * A year's tax rules, as data: the brackets per residency and the country's
 * parameters. Stored in `hr_tax_years` / `hr_tax_brackets`, seeded as drafts
 * and published by a payroll officer after checking them against the BURS or
 * SARS publication. The engine refuses a draft.
 *
 * All money is in minor units (thebe, cents) as integers. Pure.
 */

export type Country = "BW" | "ZA";
export type Residency = "resident" | "non_resident";

export type Bracket = {
  /** The bracket applies to annual taxable income above this. */
  lowerMinor: number;
  /** Null for the top bracket. */
  upperMinor: number | null;
  /** Tax on income up to `lowerMinor`. */
  baseTaxMinor: number;
  /** Marginal rate on income above `lowerMinor`, e.g. 0.26. */
  rate: number;
};

export const ZaParamsSchema = z.object({
  rebates: z.object({ primary: z.number().int().min(0), secondary: z.number().int().min(0), tertiary: z.number().int().min(0) }),
  medicalCredits: z.object({ main: z.number().int().min(0), firstDependant: z.number().int().min(0), additional: z.number().int().min(0) }),
  uif: z.object({ employeeRate: z.number().min(0).max(0.1), employerRate: z.number().min(0).max(0.1), monthlyCeilingMinor: z.number().int().positive() }),
  sdl: z.object({ rate: z.number().min(0).max(0.1), annualPayrollThresholdMinor: z.number().int().min(0) }),
  retirement: z.object({ rate: z.number().min(0).max(1), annualCapMinor: z.number().int().min(0) }),
});

export const BwParamsSchema = z.object({
  /** An employee's contribution to an approved pension fund is deductible up to this share of remuneration. */
  pensionCapRate: z.number().min(0).max(1),
});

export type ZaParams = z.infer<typeof ZaParamsSchema>;
export type BwParams = z.infer<typeof BwParamsSchema>;

export type TaxTable =
  | { country: "ZA"; code: string; status: "draft" | "published" | "retired"; startsOn: string; endsOn: string; brackets: Record<Residency, Bracket[]>; params: ZaParams }
  | { country: "BW"; code: string; status: "draft" | "published" | "retired"; startsOn: string; endsOn: string; brackets: Record<Residency, Bracket[]>; params: BwParams };

export class TaxTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxTableError";
  }
}

/** Checks a set of brackets is usable: sorted, contiguous, rates sensible. */
export function validateBrackets(brackets: readonly Bracket[]): string | null {
  if (!brackets.length) return "no brackets";
  const sorted = [...brackets].sort((a, b) => a.lowerMinor - b.lowerMinor);
  if (sorted[0].lowerMinor !== 0) return "the first bracket must start at zero";
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.rate < 0 || b.rate > 0.6) return `a rate of ${b.rate} is not plausible`;
    const next = sorted[i + 1];
    if (next) {
      if (b.upperMinor === null || b.upperMinor !== next.lowerMinor) return "the brackets have a gap or an overlap";
      // The next base is this bracket's tax at its top, give or take a cent.
      const expected = b.baseTaxMinor + Math.round((b.upperMinor - b.lowerMinor) * b.rate);
      if (Math.abs(expected - next.baseTaxMinor) > 100) return `the base amount at ${next.lowerMinor / 100} does not follow from the bracket below`;
    } else if (b.upperMinor !== null) {
      return "the top bracket must have no upper limit";
    }
  }
  return null;
}

/** Builds a table from database rows, refusing anything malformed. */
export function parseTaxTable(row: {
  country: string;
  code: string;
  status: string;
  starts_on: string;
  ends_on: string;
  parameters: unknown;
  brackets: ReadonlyArray<{ residency: string; lower_minor: number; upper_minor: number | null; base_tax_minor: number; rate: number }>;
}): TaxTable {
  const brackets: Record<Residency, Bracket[]> = { resident: [], non_resident: [] };
  for (const b of row.brackets) {
    if (b.residency !== "resident" && b.residency !== "non_resident") throw new TaxTableError(`unknown residency ${b.residency}`);
    brackets[b.residency].push({ lowerMinor: Number(b.lower_minor), upperMinor: b.upper_minor === null ? null : Number(b.upper_minor), baseTaxMinor: Number(b.base_tax_minor), rate: Number(b.rate) });
  }
  for (const r of ["resident", "non_resident"] as const) {
    brackets[r].sort((a, b) => a.lowerMinor - b.lowerMinor);
    const problem = validateBrackets(brackets[r]);
    if (problem) throw new TaxTableError(`${row.code} ${r}: ${problem}`);
  }
  const status = row.status as TaxTable["status"];
  if (row.country === "ZA") {
    const params = ZaParamsSchema.safeParse(row.parameters);
    if (!params.success) throw new TaxTableError(`${row.code}: the South African parameters are incomplete`);
    return { country: "ZA", code: row.code, status, startsOn: row.starts_on, endsOn: row.ends_on, brackets, params: params.data };
  }
  if (row.country === "BW") {
    const params = BwParamsSchema.safeParse(row.parameters);
    if (!params.success) throw new TaxTableError(`${row.code}: the Botswana parameters are incomplete`);
    return { country: "BW", code: row.code, status, startsOn: row.starts_on, endsOn: row.ends_on, brackets, params: params.data };
  }
  throw new TaxTableError(`unknown country ${row.country}`);
}

/** Annual tax on annual taxable income, before rebates. */
export function taxOnAnnual(annualMinor: number, brackets: readonly Bracket[]): number {
  if (annualMinor <= 0) return 0;
  let chosen = brackets[0];
  for (const b of brackets) if (annualMinor > b.lowerMinor) chosen = b;
  return chosen.baseTaxMinor + (annualMinor - chosen.lowerMinor) * chosen.rate;
}
