import { taxOnAnnual, TaxTableError, type TaxTable } from "@/lib/payroll/tax-table";

/**
 * One payslip, calculated. Pure, deterministic, unit tested against
 * published worked examples.
 *
 * The order is the payroll order everyone checks by hand:
 *
 *   earnings (basic, prorated for a start or exit in the month and for unpaid
 *   days; overtime; allowances) → gross
 *   → pre-tax deductions (retirement or pension, capped)
 *   → taxable → PAYE by the annualised method
 *     (×12 → brackets → minus rebates (ZA) → ÷12 → minus medical credits (ZA))
 *   → UIF (ZA, capped) → post-tax deductions → net
 *   and the employer's own costs (UIF and SDL in ZA) beside it.
 *
 * Every line carries the computed amount and the effective one: a person may
 * override any line, with a reason stored by the caller, and everything after
 * it is worked out from the effective amount. Money is integer minor units;
 * every line is rounded to the cent, and nothing else is.
 */

export const CALC_VERSION = "2026.1";

export type LineKind = "earning" | "deduction" | "tax" | "employer";

export type PayItem = {
  code: string;
  label: string;
  kind: "earning" | "allowance" | "deduction" | "employer_contribution";
  /** Earnings: counts towards taxable income. */
  taxable: boolean;
  /** Deductions: taken before tax (a retirement or pension contribution). */
  preTax: boolean;
  amountMinor: number;
};

export type PayslipInput = {
  country: "BW" | "ZA";
  /** The first and last day of the pay month, `YYYY-MM-DD`. */
  periodStart: string;
  periodEnd: string;
  employee: {
    startDate: string;
    endDate: string | null;
    dateOfBirth: string | null;
    residency: "resident" | "non_resident";
    /** ZA medical scheme members: the employee counts as one. 0 if not on a scheme. */
    medicalMembers: number;
    hasTaxNumber: boolean;
  };
  compensation: {
    basis: "monthly" | "hourly";
    basicMonthlyMinor: number;
    hourlyRateMinor: number;
    normalHoursPerMonth: number;
  } | null;
  items: readonly PayItem[];
  timesheet: {
    normalHours: number;
    overtimeHours: number;
    sundayHours: number;
    publicHolidayHours: number;
    unpaidDays: number;
  } | null;
  /** ZA: whether the employer's annual payroll is above the SDL threshold. */
  sdlApplies: boolean;
  overrides: Readonly<Record<string, number>>;
};

export type PayslipLine = {
  code: string;
  label: string;
  kind: LineKind;
  computedMinor: number;
  effectiveMinor: number;
  overridden: boolean;
};

export type PayslipResult = {
  lines: PayslipLine[];
  grossMinor: number;
  taxableMinor: number;
  payeMinor: number;
  uifEmployeeMinor: number;
  uifEmployerMinor: number;
  sdlMinor: number;
  deductionsMinor: number;
  netMinor: number;
  employerCostMinor: number;
  warnings: string[];
  calcVersion: string;
};

const cents = (n: number) => Math.round(n);

/** Monday to Friday between two dates inclusive. Public holidays are not removed: a month is a month. */
export function weekdaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  let n = 0;
  for (let d = from; d <= to; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

/** Age on a date, in whole years. */
export function ageOn(dobIso: string, onIso: string): number {
  const [y, m, d] = dobIso.split("-").map(Number);
  const [y2, m2, d2] = onIso.split("-").map(Number);
  return y2 - y - (m2 < m || (m2 === m && d2 < d) ? 1 : 0);
}

export function calculatePayslip(input: PayslipInput, table: TaxTable): PayslipResult {
  if (table.status !== "published") {
    throw new TaxTableError(`The ${table.code} tax table is a draft. A payroll officer must check and publish it before payroll can run.`);
  }
  if (table.country !== input.country) throw new TaxTableError(`The ${table.code} tax table is for ${table.country}, not ${input.country}.`);
  if (input.periodStart < table.startsOn || input.periodEnd > table.endsOn) {
    throw new TaxTableError(`The ${table.code} tax table does not cover ${input.periodStart.slice(0, 7)}.`);
  }

  const warnings: string[] = [];
  const lines: PayslipLine[] = [];
  const add = (code: string, label: string, kind: LineKind, computed: number): number => {
    const c = cents(computed);
    const override = input.overrides[code];
    const effective = override === undefined ? c : Math.round(override);
    lines.push({ code, label, kind, computedMinor: c, effectiveMinor: effective, overridden: override !== undefined && override !== c });
    return effective;
  };

  // --- Earnings -------------------------------------------------------------
  const comp = input.compensation;
  if (!comp) warnings.push("No salary is set up for this employee.");
  const ts = input.timesheet;
  const workingDays = weekdaysBetween(input.periodStart, input.periodEnd);
  const employedFrom = input.employee.startDate > input.periodStart ? input.employee.startDate : input.periodStart;
  const employedTo = input.employee.endDate && input.employee.endDate < input.periodEnd ? input.employee.endDate : input.periodEnd;
  const employedDays = employedFrom <= employedTo ? weekdaysBetween(employedFrom, employedTo) : 0;

  let gross = 0;
  let taxableEarnings = 0;
  let hourly = 0;
  if (comp) {
    if (comp.basis === "monthly") {
      hourly = comp.normalHoursPerMonth > 0 ? comp.basicMonthlyMinor / comp.normalHoursPerMonth : 0;
      const daily = workingDays ? comp.basicMonthlyMinor / workingDays : 0;
      const prorated = employedDays >= workingDays ? comp.basicMonthlyMinor : daily * employedDays;
      if (employedDays < workingDays) warnings.push(`Basic pay is prorated: ${employedDays} of ${workingDays} working days.`);
      const basic = add("BASIC", "Basic salary", "earning", prorated);
      gross += basic;
      taxableEarnings += basic;
      if (ts && ts.unpaidDays > 0) {
        const unpaid = add("UNPAID", `Unpaid leave (${ts.unpaidDays} day${ts.unpaidDays === 1 ? "" : "s"})`, "earning", -daily * ts.unpaidDays);
        gross += unpaid;
        taxableEarnings += unpaid;
      }
    } else {
      hourly = comp.hourlyRateMinor;
      if (!ts) warnings.push("Paid by the hour, but there is no timesheet for this month.");
      const basic = add("BASIC", `Hours worked (${ts?.normalHours ?? 0})`, "earning", hourly * (ts?.normalHours ?? 0));
      gross += basic;
      taxableEarnings += basic;
    }
    if (ts) {
      const extras: Array<[string, string, number, number]> = [
        ["OVERTIME", "Overtime", ts.overtimeHours, 1.5],
        ["SUNDAY", "Sunday work", ts.sundayHours, 2],
        ["PUBLIC_HOLIDAY", "Public holiday work", ts.publicHolidayHours, 2],
      ];
      for (const [code, label, hours, multiple] of extras) {
        if (hours > 0) {
          const v = add(code, `${label} (${hours} h at ${multiple}×)`, "earning", hourly * hours * multiple);
          gross += v;
          taxableEarnings += v;
        }
      }
    }
  }
  for (const item of input.items.filter((i) => i.kind === "earning" || i.kind === "allowance")) {
    const v = add(item.code, item.label, "earning", item.amountMinor);
    gross += v;
    if (item.taxable) taxableEarnings += v;
  }

  // --- Pre-tax deductions, capped -----------------------------------------------
  let preTax = 0;
  for (const item of input.items.filter((i) => i.kind === "deduction" && i.preTax)) {
    let allowed = item.amountMinor;
    if (table.country === "ZA") {
      const cap = Math.min(taxableEarnings * table.params.retirement.rate, table.params.retirement.annualCapMinor / 12);
      allowed = Math.min(allowed, Math.max(0, cap - preTax));
    } else {
      const cap = taxableEarnings * table.params.pensionCapRate;
      allowed = Math.min(allowed, Math.max(0, cap - preTax));
    }
    if (allowed < item.amountMinor) warnings.push(`Only part of ${item.label} reduces tax: the rest is above the deductible limit.`);
    // The whole contribution is deducted from pay; only the allowed part reduces tax.
    preTax += add(item.code, item.label, "deduction", item.amountMinor) - (item.amountMinor - allowed);
  }
  const preTaxDeducted = lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.effectiveMinor, 0);
  const taxable = Math.max(0, taxableEarnings - preTax);

  // --- PAYE, annualised -----------------------------------------------------------
  const brackets = table.brackets[input.employee.residency];
  const annual = taxable * 12;
  let annualTax = taxOnAnnual(annual, brackets);
  let monthlyCredits = 0;
  if (table.country === "ZA") {
    const p = table.params;
    const age = input.employee.dateOfBirth ? ageOn(input.employee.dateOfBirth, table.endsOn) : 0;
    const rebate = p.rebates.primary + (age >= 65 ? p.rebates.secondary : 0) + (age >= 75 ? p.rebates.tertiary : 0);
    annualTax = Math.max(0, annualTax - rebate);
    const m = input.employee.medicalMembers;
    monthlyCredits = m <= 0 ? 0 : p.medicalCredits.main + (m >= 2 ? p.medicalCredits.firstDependant : 0) + Math.max(0, m - 2) * p.medicalCredits.additional;
  }
  const paye = add("PAYE", "Income tax (PAYE)", "tax", Math.max(0, annualTax / 12 - monthlyCredits));
  if (!input.employee.hasTaxNumber) warnings.push("No tax number is recorded for this employee.");

  // --- UIF and SDL (South Africa) --------------------------------------------------
  let uifEe = 0;
  let uifEr = 0;
  let sdl = 0;
  if (table.country === "ZA") {
    const base = Math.min(Math.max(gross, 0), table.params.uif.monthlyCeilingMinor);
    uifEe = add("UIF", "Unemployment insurance (UIF)", "tax", base * table.params.uif.employeeRate);
    uifEr = add("UIF_ER", "UIF (employer)", "employer", base * table.params.uif.employerRate);
    if (input.sdlApplies) sdl = add("SDL", "Skills development levy (employer)", "employer", Math.max(gross, 0) * table.params.sdl.rate);
  }

  // --- Post-tax deductions ------------------------------------------------------------
  let postTax = 0;
  for (const item of input.items.filter((i) => i.kind === "deduction" && !i.preTax)) postTax += add(item.code, item.label, "deduction", item.amountMinor);
  let employerContributions = 0;
  for (const item of input.items.filter((i) => i.kind === "employer_contribution")) employerContributions += add(item.code, item.label, "employer", item.amountMinor);

  const deductions = preTaxDeducted + postTax + paye + uifEe;
  const net = gross - deductions;
  if (net < 0) warnings.push("Deductions are more than pay this month: net pay is below zero.");

  return {
    lines,
    grossMinor: gross,
    taxableMinor: taxable,
    payeMinor: paye,
    uifEmployeeMinor: uifEe,
    uifEmployerMinor: uifEr,
    sdlMinor: sdl,
    deductionsMinor: deductions,
    netMinor: net,
    employerCostMinor: gross + uifEr + sdl + employerContributions,
    warnings,
    calcVersion: CALC_VERSION,
  };
}
