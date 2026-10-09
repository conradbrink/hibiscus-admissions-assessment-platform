/**
 * The month's files for the bank, the accounts and the tax authority, as
 * CSV. Pure: the route loads the rows, these turn them into text.
 *
 * Every cell is quoted, and a cell that a spreadsheet would read as a
 * formula (starting =, +, -, @, tab or carriage return) is prefixed with an
 * apostrophe, so a name typed as "=HYPERLINK(...)" stays a name.
 */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Minor units as a plain decimal, which every bank and spreadsheet reads: 1234.50. */
export function decimal(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type ExportSlip = {
  employeeNumber: string;
  name: string;
  taxNumber: string | null;
  grossMinor: number;
  taxableMinor: number;
  payeMinor: number;
  uifEmployeeMinor: number;
  uifEmployerMinor: number;
  sdlMinor: number;
  netMinor: number;
  lines: ReadonlyArray<{ code: string; label: string; kind: string; effectiveMinor: number }>;
};

export type ExportBank = { bankName: string; branchCode: string | null; accountName: string; accountNumber: string } | null;

/** One payment per employee: who, where, how much. People without bank details are listed with blanks to fill. */
export function bankFile(slips: ReadonlyArray<ExportSlip & { bank: ExportBank }>, reference: string): string {
  return toCsv([
    ["Employee number", "Name", "Bank", "Branch code", "Account name", "Account number", "Amount", "Reference"],
    ...slips
      .filter((s) => s.netMinor > 0)
      .map((s) => [s.employeeNumber, s.name, s.bank?.bankName ?? "", s.bank?.branchCode ?? "", s.bank?.accountName ?? "", s.bank?.accountNumber ?? "", decimal(s.netMinor), reference]),
  ]);
}

/** Totals by payslip line, for the accounts: one row per line code. */
export function journal(slips: ReadonlyArray<ExportSlip>, currency: string): string {
  const byCode = new Map<string, { label: string; kind: string; total: number; count: number }>();
  for (const s of slips) {
    for (const l of s.lines) {
      const row = byCode.get(l.code) ?? { label: l.label.replace(/\s*\(.*\)$/, ""), kind: l.kind, total: 0, count: 0 };
      row.total += l.effectiveMinor;
      row.count += 1;
      byCode.set(l.code, row);
    }
  }
  const order = { earning: 0, deduction: 1, tax: 2, employer: 3 } as Record<string, number>;
  const rows = [...byCode.entries()].sort((a, b) => (order[a[1].kind] ?? 9) - (order[b[1].kind] ?? 9) || a[0].localeCompare(b[0]));
  const net = slips.reduce((t, s) => t + s.netMinor, 0);
  return toCsv([
    ["Code", "Description", "Type", "Employees", `Amount (${currency})`],
    ...rows.map(([code, r]) => [code, r.label, r.kind, r.count, decimal(r.total)]),
    ["NET", "Net pay", "net", slips.length, decimal(net)],
  ]);
}

/**
 * What is owed to the tax authority. South Africa: PAYE, UIF (both shares)
 * and SDL, the figures for the EMP201. Botswana: PAYE for the monthly BURS
 * remittance. Per employee, then the total.
 */
export function statutory(slips: ReadonlyArray<ExportSlip>, country: "BW" | "ZA"): string {
  const sum = (f: (s: ExportSlip) => number) => slips.reduce((t, s) => t + f(s), 0);
  if (country === "BW") {
    return toCsv([
      ["Employee number", "Name", "Tax number", "Gross", "Taxable", "PAYE"],
      ...slips.map((s) => [s.employeeNumber, s.name, s.taxNumber ?? "", decimal(s.grossMinor), decimal(s.taxableMinor), decimal(s.payeMinor)]),
      ["TOTAL", "", "", decimal(sum((s) => s.grossMinor)), decimal(sum((s) => s.taxableMinor)), decimal(sum((s) => s.payeMinor))],
    ]);
  }
  return toCsv([
    ["Employee number", "Name", "Tax number", "Gross", "Taxable", "PAYE", "UIF employee", "UIF employer", "SDL"],
    ...slips.map((s) => [
      s.employeeNumber,
      s.name,
      s.taxNumber ?? "",
      decimal(s.grossMinor),
      decimal(s.taxableMinor),
      decimal(s.payeMinor),
      decimal(s.uifEmployeeMinor),
      decimal(s.uifEmployerMinor),
      decimal(s.sdlMinor),
    ]),
    [
      "TOTAL",
      "",
      "",
      decimal(sum((s) => s.grossMinor)),
      decimal(sum((s) => s.taxableMinor)),
      decimal(sum((s) => s.payeMinor)),
      decimal(sum((s) => s.uifEmployeeMinor)),
      decimal(sum((s) => s.uifEmployerMinor)),
      decimal(sum((s) => s.sdlMinor)),
    ],
  ]);
}
