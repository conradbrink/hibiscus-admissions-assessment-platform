import { describe, expect, it } from "vitest";
import { ageOn, calculatePayslip, weekdaysBetween, type PayslipInput } from "@/lib/payroll/calculate";
import { parseTaxTable, taxOnAnnual, TaxTableError, validateBrackets, type TaxTable } from "@/lib/payroll/tax-table";

// The 2027 South African year (1 March 2026 to 28 February 2027) and the
// Botswana year from 1 July 2026, in minor units. Worked examples below are
// done by hand from the published bracket formulas.
const R = (rands: number) => Math.round(rands * 100);

const ZA: TaxTable = parseTaxTable({
  country: "ZA",
  code: "ZA-2027",
  status: "published",
  starts_on: "2026-03-01",
  ends_on: "2027-02-28",
  parameters: {
    rebates: { primary: R(17820), secondary: R(9765), tertiary: R(3249) },
    medicalCredits: { main: R(364), firstDependant: R(364), additional: R(246) },
    uif: { employeeRate: 0.01, employerRate: 0.01, monthlyCeilingMinor: R(17712) },
    sdl: { rate: 0.01, annualPayrollThresholdMinor: R(500000) },
    retirement: { rate: 0.275, annualCapMinor: R(350000) },
  },
  brackets: (["resident", "non_resident"] as const).flatMap((residency) => [
    { residency, lower_minor: 0, upper_minor: R(245100), base_tax_minor: 0, rate: 0.18 },
    { residency, lower_minor: R(245100), upper_minor: R(383100), base_tax_minor: R(44118), rate: 0.26 },
    { residency, lower_minor: R(383100), upper_minor: R(530200), base_tax_minor: R(79998), rate: 0.31 },
    { residency, lower_minor: R(530200), upper_minor: R(695800), base_tax_minor: R(125599), rate: 0.36 },
    { residency, lower_minor: R(695800), upper_minor: R(887000), base_tax_minor: R(185215), rate: 0.39 },
    { residency, lower_minor: R(887000), upper_minor: R(1878600), base_tax_minor: R(259783), rate: 0.41 },
    { residency, lower_minor: R(1878600), upper_minor: null, base_tax_minor: R(666339), rate: 0.45 },
  ]),
});

const BW: TaxTable = parseTaxTable({
  country: "BW",
  code: "BW-2026/27",
  status: "published",
  starts_on: "2026-07-01",
  ends_on: "2027-06-30",
  parameters: { pensionCapRate: 0.15 },
  brackets: [
    { residency: "resident", lower_minor: 0, upper_minor: R(48000), base_tax_minor: 0, rate: 0 },
    { residency: "resident", lower_minor: R(48000), upper_minor: R(84000), base_tax_minor: 0, rate: 0.05 },
    { residency: "resident", lower_minor: R(84000), upper_minor: R(120000), base_tax_minor: R(1800), rate: 0.125 },
    { residency: "resident", lower_minor: R(120000), upper_minor: R(156000), base_tax_minor: R(6300), rate: 0.1875 },
    { residency: "resident", lower_minor: R(156000), upper_minor: R(400000), base_tax_minor: R(13050), rate: 0.25 },
    { residency: "resident", lower_minor: R(400000), upper_minor: null, base_tax_minor: R(74050), rate: 0.275 },
    { residency: "non_resident", lower_minor: 0, upper_minor: R(84000), base_tax_minor: 0, rate: 0.05 },
    { residency: "non_resident", lower_minor: R(84000), upper_minor: R(120000), base_tax_minor: R(4200), rate: 0.125 },
    { residency: "non_resident", lower_minor: R(120000), upper_minor: R(156000), base_tax_minor: R(8700), rate: 0.1875 },
    { residency: "non_resident", lower_minor: R(156000), upper_minor: R(400000), base_tax_minor: R(15450), rate: 0.25 },
    { residency: "non_resident", lower_minor: R(400000), upper_minor: null, base_tax_minor: R(76450), rate: 0.275 },
  ],
});

function input(over: Partial<PayslipInput> = {}): PayslipInput {
  return {
    country: "ZA",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    employee: { startDate: "2020-01-01", endDate: null, dateOfBirth: "1986-05-10", residency: "resident", medicalMembers: 0, hasTaxNumber: true },
    compensation: { basis: "monthly", basicMonthlyMinor: R(30000), hourlyRateMinor: 0, normalHoursPerMonth: 173.33 },
    items: [],
    timesheet: null,
    sdlApplies: false,
    overrides: {},
    ...over,
  };
}

describe("South Africa", () => {
  it("taxes R30,000 a month as the bracket formula says", () => {
    // 360,000 a year: 44,118 + 26% of 114,900 = 73,992, less 17,820 = 56,172, ÷ 12 = 4,681.
    const r = calculatePayslip(input(), ZA);
    expect(r.payeMinor).toBe(R(4681));
    // UIF is 1% of the R17,712 ceiling, not of R30,000.
    expect(r.uifEmployeeMinor).toBe(R(177.12));
    expect(r.netMinor).toBe(R(30000 - 4681 - 177.12));
  });

  it("charges nothing below the threshold", () => {
    // R99,000 a year is the 2027 threshold for under-65s.
    const r = calculatePayslip(input({ compensation: { basis: "monthly", basicMonthlyMinor: R(8250), hourlyRateMinor: 0, normalHoursPerMonth: 173.33 } }), ZA);
    expect(r.payeMinor).toBe(0);
  });

  it("gives the secondary rebate from 65 and the tertiary from 75, at the end of the tax year", () => {
    const at64 = calculatePayslip(input({ employee: { ...input().employee, dateOfBirth: "1962-03-01" } }), ZA); // 64 on 28 Feb 2027
    const at65 = calculatePayslip(input({ employee: { ...input().employee, dateOfBirth: "1962-02-28" } }), ZA);
    expect(at64.payeMinor - at65.payeMinor).toBe(R(9765 / 12));
    const at75 = calculatePayslip(input({ employee: { ...input().employee, dateOfBirth: "1950-01-01" } }), ZA);
    expect(at65.payeMinor - at75.payeMinor).toBe(R(3249 / 12));
  });

  it("takes medical credits off the monthly tax", () => {
    const r = calculatePayslip(input({ employee: { ...input().employee, medicalMembers: 3 } }), ZA);
    expect(r.payeMinor).toBe(R(4681 - 364 - 364 - 246));
  });

  it("caps a retirement contribution at 27.5% of taxable pay", () => {
    const r = calculatePayslip(
      input({ items: [{ code: "PENSION", label: "Retirement fund", kind: "deduction", taxable: false, preTax: true, amountMinor: R(12000) }] }),
      ZA
    );
    // Only 8,250 (27.5% of 30,000) reduces tax; all 12,000 comes off pay.
    expect(r.taxableMinor).toBe(R(30000 - 8250));
    expect(r.netMinor).toBe(R(30000) - R(12000) - r.payeMinor - r.uifEmployeeMinor);
    expect(r.warnings.join(" ")).toMatch(/deductible limit/);
  });

  it("adds SDL as an employer cost only when the payroll is above the threshold", () => {
    expect(calculatePayslip(input(), ZA).sdlMinor).toBe(0);
    const r = calculatePayslip(input({ sdlApplies: true }), ZA);
    expect(r.sdlMinor).toBe(R(300));
    expect(r.netMinor).toBe(calculatePayslip(input(), ZA).netMinor);
    expect(r.employerCostMinor).toBe(R(30000 + 177.12 + 300));
  });

  it("works out tax on the effective amounts when a person overrides a line", () => {
    const r = calculatePayslip(input({ overrides: { BASIC: R(20000) } }), ZA);
    // 240,000 a year: 18% = 43,200 less 17,820 = 25,380, ÷ 12 = 2,115.
    expect(r.payeMinor).toBe(R(2115));
    expect(r.lines.find((l) => l.code === "BASIC")).toMatchObject({ computedMinor: R(30000), effectiveMinor: R(20000), overridden: true });
  });

  it("lets PAYE itself be overridden", () => {
    const r = calculatePayslip(input({ overrides: { PAYE: R(5000) } }), ZA);
    expect(r.payeMinor).toBe(R(5000));
    expect(r.netMinor).toBe(R(30000 - 5000 - 177.12));
  });
});

describe("Botswana", () => {
  const bw = (over: Partial<PayslipInput> = {}) => input({ country: "BW", periodStart: "2026-10-01", periodEnd: "2026-10-31", ...over });

  it("taxes P10,000 a month at the 12.5% band", () => {
    // 120,000 a year: 1,800 + 12.5% of 36,000 = 6,300, ÷ 12 = 525.
    const r = calculatePayslip(bw({ compensation: { basis: "monthly", basicMonthlyMinor: R(10000), hourlyRateMinor: 0, normalHoursPerMonth: 173.33 } }), BW);
    expect(r.payeMinor).toBe(R(525));
    expect(r.uifEmployeeMinor).toBe(0);
    expect(r.netMinor).toBe(R(9475));
  });

  it("uses the top band above P400,000 a year", () => {
    // 600,000: 74,050 + 27.5% of 200,000 = 129,050, ÷ 12 = 10,754.17.
    const r = calculatePayslip(bw({ compensation: { basis: "monthly", basicMonthlyMinor: R(50000), hourlyRateMinor: 0, normalHoursPerMonth: 173.33 } }), BW);
    expect(r.payeMinor).toBe(R(10754.17));
  });

  it("taxes a non-resident from the first pula", () => {
    const r = calculatePayslip(
      bw({
        compensation: { basis: "monthly", basicMonthlyMinor: R(3000), hourlyRateMinor: 0, normalHoursPerMonth: 173.33 },
        employee: { ...input().employee, residency: "non_resident" },
      }),
      BW
    );
    // 36,000 a year at 5% = 1,800, ÷ 12 = 150. A resident pays nothing.
    expect(r.payeMinor).toBe(R(150));
  });

  it("caps a pension contribution at 15% for tax", () => {
    const r = calculatePayslip(
      bw({
        compensation: { basis: "monthly", basicMonthlyMinor: R(10000), hourlyRateMinor: 0, normalHoursPerMonth: 173.33 },
        items: [{ code: "PENSION", label: "Pension fund", kind: "deduction", taxable: false, preTax: true, amountMinor: R(2000) }],
      }),
      BW
    );
    expect(r.taxableMinor).toBe(R(8500));
  });

  it("refuses a South African table", () => {
    expect(() => calculatePayslip(bw(), ZA)).toThrow(TaxTableError);
  });
});

describe("earnings", () => {
  it("prorates a start in the middle of the month by working days", () => {
    // October 2026 has 22 weekdays; from Thursday the 15th there are 12.
    const r = calculatePayslip(input({ employee: { ...input().employee, startDate: "2026-10-15" } }), ZA);
    expect(r.lines.find((l) => l.code === "BASIC")?.computedMinor).toBe(R((30000 / 22) * 12));
    expect(r.warnings.join(" ")).toMatch(/prorated/);
  });

  it("deducts unpaid days and pays overtime at time and a half", () => {
    const r = calculatePayslip(input({ timesheet: { normalHours: 0, overtimeHours: 10, sundayHours: 0, publicHolidayHours: 0, unpaidDays: 2 } }), ZA);
    expect(r.lines.find((l) => l.code === "UNPAID")?.computedMinor).toBe(R((-30000 / 22) * 2));
    expect(r.lines.find((l) => l.code === "OVERTIME")?.computedMinor).toBe(R((30000 / 173.33) * 10 * 1.5));
  });

  it("pays an hourly worker for the hours on the timesheet", () => {
    const r = calculatePayslip(
      input({
        compensation: { basis: "hourly", basicMonthlyMinor: 0, hourlyRateMinor: R(80), normalHoursPerMonth: 0 },
        timesheet: { normalHours: 100, overtimeHours: 0, sundayHours: 4, publicHolidayHours: 0, unpaidDays: 0 },
      }),
      ZA
    );
    expect(r.grossMinor).toBe(R(8000 + 80 * 4 * 2));
  });

  it("keeps a non-taxable allowance out of PAYE but in pay", () => {
    const base = calculatePayslip(input(), ZA);
    const r = calculatePayslip(input({ items: [{ code: "TRAVEL", label: "Travel reimbursement", kind: "allowance", taxable: false, preTax: false, amountMinor: R(1000) }] }), ZA);
    expect(r.payeMinor).toBe(base.payeMinor);
    expect(r.netMinor).toBe(base.netMinor + R(1000) - (r.uifEmployeeMinor - base.uifEmployeeMinor));
  });

  it("warns when deductions exceed pay", () => {
    const r = calculatePayslip(input({ items: [{ code: "LOAN", label: "Staff loan", kind: "deduction", taxable: false, preTax: false, amountMinor: R(40000) }] }), ZA);
    expect(r.netMinor).toBeLessThan(0);
    expect(r.warnings.join(" ")).toMatch(/below zero/);
  });
});

describe("tax tables", () => {
  it("refuses a draft", () => {
    expect(() => calculatePayslip(input(), { ...ZA, status: "draft" })).toThrow(/draft/);
  });

  it("refuses a month outside the year", () => {
    expect(() => calculatePayslip(input({ periodStart: "2027-03-01", periodEnd: "2027-03-31" }), ZA)).toThrow(/does not cover/);
  });

  it("catches brackets with a gap, or a base that does not follow", () => {
    expect(validateBrackets([{ lowerMinor: 0, upperMinor: 100, baseTaxMinor: 0, rate: 0.1 }, { lowerMinor: 200, upperMinor: null, baseTaxMinor: 10, rate: 0.2 }])).toMatch(/gap/);
    expect(validateBrackets([{ lowerMinor: 0, upperMinor: 100000, baseTaxMinor: 0, rate: 0.1 }, { lowerMinor: 100000, upperMinor: null, baseTaxMinor: 50000, rate: 0.2 }])).toMatch(/does not follow/);
  });

  it("taxes each bracket edge continuously", () => {
    const brackets = ZA.brackets.resident;
    for (const b of brackets.slice(1)) {
      expect(Math.abs(taxOnAnnual(b.lowerMinor, brackets) - taxOnAnnual(b.lowerMinor + 1, brackets))).toBeLessThan(1);
    }
  });
});

describe("helpers", () => {
  it("counts weekdays", () => {
    expect(weekdaysBetween("2026-10-01", "2026-10-31")).toBe(22);
    expect(weekdaysBetween("2026-10-03", "2026-10-04")).toBe(0);
  });

  it("knows a birthday has not happened yet", () => {
    expect(ageOn("1960-03-01", "2027-02-28")).toBe(66);
    expect(ageOn("1962-03-01", "2027-02-28")).toBe(64);
  });
});
