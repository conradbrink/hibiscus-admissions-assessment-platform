import { describe, expect, it } from "vitest";
import { bankFile, csvCell, decimal, journal, statutory, type ExportSlip } from "@/lib/payroll/exports";

const slip = (over: Partial<ExportSlip> = {}): ExportSlip => ({
  employeeNumber: "HIS-00001",
  name: "Neo Molefe",
  taxNumber: "123",
  grossMinor: 3_000_000,
  taxableMinor: 3_000_000,
  payeMinor: 468_100,
  uifEmployeeMinor: 17_712,
  uifEmployerMinor: 17_712,
  sdlMinor: 30_000,
  netMinor: 2_514_188,
  lines: [
    { code: "BASIC", label: "Basic salary", kind: "earning", effectiveMinor: 3_000_000 },
    { code: "PAYE", label: "Income tax (PAYE)", kind: "tax", effectiveMinor: 468_100 },
    { code: "UIF", label: "Unemployment insurance (UIF)", kind: "tax", effectiveMinor: 17_712 },
  ],
  ...over,
});

describe("payroll exports", () => {
  it("writes amounts as plain decimals", () => {
    expect(decimal(123450)).toBe("1234.50");
    expect(decimal(5)).toBe("0.05");
    expect(decimal(-250)).toBe("-2.50");
  });

  it("defuses cells a spreadsheet would run as formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-1+1")).toBe("\"'-1+1\"");
    expect(csvCell(-1)).toBe('"-1"');
    expect(csvCell("Neo")).toBe('"Neo"');
  });

  it("pays net pay, and leaves out people with nothing to pay", () => {
    const csv = bankFile(
      [
        { ...slip(), bank: { bankName: "FNB", branchCode: "250655", accountName: "N Molefe", accountNumber: "62000000001" } },
        { ...slip({ employeeNumber: "HIS-00002", netMinor: 0 }), bank: null },
      ],
      "Salary 2026-10"
    );
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe('"HIS-00001","Neo Molefe","FNB","250655","N Molefe","62000000001","25141.88","Salary 2026-10"');
  });

  it("totals the journal by line code and ends with net pay", () => {
    const csv = journal([slip(), slip({ employeeNumber: "HIS-00002" })], "ZAR");
    expect(csv).toContain('"BASIC","Basic salary","earning","2","60000.00"');
    expect(csv).toContain('"PAYE","Income tax","tax","2","9362.00"');
    expect(csv.trim().split("\r\n").at(-1)).toBe('"NET","Net pay","net","2","50283.76"');
  });

  it("gives the EMP201 figures in South Africa and PAYE alone in Botswana", () => {
    const za = statutory([slip()], "ZA");
    expect(za.split("\r\n")[0]).toContain("SDL");
    expect(za).toContain('"TOTAL","","","30000.00","30000.00","4681.00","177.12","177.12","300.00"');
    const bw = statutory([slip()], "BW");
    expect(bw.split("\r\n")[0]).not.toContain("UIF");
  });
});
