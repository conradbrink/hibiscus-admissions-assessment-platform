import { describe, expect, it } from "vitest";
import { applyTransform, exportFilename, isMedicalPath, renderRows, resolvePath, toCsv, toJson } from "@/lib/enrolment/export";

const snapshot = {
  application: { reference: "HBS-2026-00482", campus: "Block 7", grade: "Stage 4", start_date: "2027-01-11" },
  student: { legal_first_name: "Thato", legal_last_name: "Moyo", date_of_birth: "2017-04-15", preferred_name: null },
  guardians: [{ first_name: "Sarah", last_name: "Moyo", mobile: "+26771234567" }],
  emergency_contacts: [],
  medical: { emergency_treatment_consent: true, allergies: "Peanuts, \"tree\" nuts" },
  payment: { currency: "BWP", amount_minor: 750000, paid_at: "2026-09-14T08:00:00Z" },
};

describe("resolvePath", () => {
  it("walks objects and arrays and returns null for anything missing", () => {
    expect(resolvePath(snapshot, "student.legal_first_name")).toBe("Thato");
    expect(resolvePath(snapshot, "guardians[0].mobile")).toBe("+26771234567");
    expect(resolvePath(snapshot, "guardians[1].mobile")).toBeNull();
    expect(resolvePath(snapshot, "emergency_contacts[0].phone")).toBeNull();
    expect(resolvePath(snapshot, "student.preferred_name")).toBeNull();
    expect(resolvePath(snapshot, "nope.deeper")).toBeNull();
    expect(resolvePath(snapshot, "student.__proto__")).toBeNull();
  });
});

describe("applyTransform", () => {
  it("formats dates, money, booleans and case", () => {
    expect(applyTransform("2017-04-15", "date_dmy")).toBe("15/04/2017");
    expect(applyTransform("2026-09-14T08:00:00Z", "date_ymd")).toBe("2026-09-14");
    expect(applyTransform(750000, "money")).toBe("7500.00");
    expect(applyTransform(true, "yes_no")).toBe("Yes");
    expect(applyTransform(null, "yes_no")).toBe("");
    expect(applyTransform("Moyo", "upper")).toBe("MOYO");
    expect(applyTransform(null, "none")).toBe("");
  });
});

describe("csv and json", () => {
  const columns = [
    { header: "Reference", source_path: "application.reference", transform: "none" as const },
    { header: "Surname", source_path: "student.legal_last_name", transform: "upper" as const },
    { header: "DOB", source_path: "student.date_of_birth", transform: "date_dmy" as const },
    { header: "Allergies", source_path: "medical.allergies", transform: "none" as const },
    { header: "Fees", source_path: "payment.amount_minor", transform: "money" as const },
  ];
  const rows = renderRows([snapshot], columns);
  it("renders rows in column order", () => {
    expect(rows).toEqual([["HBS-2026-00482", "MOYO", "15/04/2017", 'Peanuts, "tree" nuts', "7500.00"]]);
  });
  it("writes RFC 4180 CSV with a BOM and CRLF, quoting what needs it", () => {
    const csv = toCsv(columns.map((c) => c.header), rows);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Peanuts, ""tree"" nuts"');
    expect(csv.split("\r\n")).toHaveLength(3);
  });
  it("neutralises a value a spreadsheet would run as a formula", () => {
    expect(toCsv(["x"], [["=SUM(A1)"]])).toContain("'=SUM(A1)");
  });
  it("writes JSON keyed by header", () => {
    expect(JSON.parse(toJson(["Reference", "Surname"], [["R", "S"]]))).toEqual([{ Reference: "R", Surname: "S" }]);
  });
  it("names the file and knows a medical path", () => {
    expect(exportFilename("csv", new Date("2026-09-05T10:34:00Z"), "block7")).toBe("hibiscus-students-block7-202609051034.csv");
    expect(isMedicalPath("medical.allergies")).toBe(true);
    expect(isMedicalPath("student.gender")).toBe(false);
  });
});
