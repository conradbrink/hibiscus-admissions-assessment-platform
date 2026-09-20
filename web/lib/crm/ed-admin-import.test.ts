import { describe, expect, it } from "vitest";
import { BASIC_COLUMNS, G1_ADDRESS_COLUMNS, G1_CONTACT_COLUMNS, G2_ADDRESS_COLUMNS, G2_CONTACT_COLUMNS, STUDENT_COLUMNS } from "@/lib/enrolment/ed-admin";
import {
  detectEdAdminKind,
  duplicateParentsWithinFile,
  duplicateStudentsWithinFile,
  findStudentTable,
  genderFrom,
  headerKey,
  mapStudentHeaders,
  mergeParentTables,
  parseEdAdminDate,
  relationshipFrom,
  studentStatusFrom,
  validateParentRecord,
  validateStudentRow,
  type GradeMapping,
  type Table,
} from "@/lib/crm/ed-admin-import";

const grades = new Map<string, GradeMapping>([
  ["Stage5-HPS", { code: "Stage5-HPS", campusId: "c-hps", campusName: "Block 7", gradeId: "g-s5", gradeName: "Stage 5" }],
  ["NURSERY-TLK", { code: "NURSERY-TLK", campusId: "c-tlk", campusName: "Tlokweng", gradeId: "g-nur", gradeName: "Nursery" }],
]);

/** One row in the exact shape the export writes, with a few cells changed. */
function studentRow(over: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    "Family Code*": "COE0001", "Admission Number*": "HBS-2026-00019", "Grade*": "Stage5-HPS", "Last Name*": "Coetzer", "First Name*": "Abigail",
    "Middle Name": "Rose", "Other Names": "Abi", "Gender*": "F", "Date of Birth*": "09/09/2020", "Place Of Birth": "Gaborone", "Nationality": "Motswana",
    "Born in": "Botswana", "ID Number": "123456789", "Language": "Setswana", "Prev. School": "Little Acorns", "Date of Application*": "01/03/2026",
    "Date of Entry*": "11/01/2027", "Status": "Current",
  };
  return STUDENT_COLUMNS.map((c) => over[c] ?? base[c] ?? "");
}

describe("headerKey and dates", () => {
  it("reduces their headers to letters and digits", () => {
    expect(headerKey("Family/Sponsor Code*")).toBe("familysponsorcode");
    expect(headerKey("Family/SponsorCode*")).toBe("familysponsorcode");
    expect(headerKey("G1 Res. Addr 2")).toBe("g1resaddr2");
    expect(headerKey("G2LName")).toBe("g2lname");
    expect(headerKey("date_of_birth")).toBe("dateofbirth");
  });
  it("reads day/month/year first, year-first when the year leads, a spelled month and a day count", () => {
    expect(parseEdAdminDate("09/09/2020")).toBe("2020-09-09");
    expect(parseEdAdminDate("31/01/2019")).toBe("2019-01-31");
    expect(parseEdAdminDate("2020/09/09")).toBe("2020-09-09");
    expect(parseEdAdminDate("2020-09-09")).toBe("2020-09-09");
    expect(parseEdAdminDate("2020-09-09T00:00:00")).toBe("2020-09-09");
    expect(parseEdAdminDate("9 Sep 2020")).toBe("2020-09-09");
    expect(parseEdAdminDate("09-Sept-2020")).toBe("2020-09-09");
    expect(parseEdAdminDate("September 9, 2020")).toBe("2020-09-09");
    expect(parseEdAdminDate("09/09/20")).toBe("2020-09-09");
    expect(parseEdAdminDate("09/09/85")).toBe("1985-09-09");
    expect(parseEdAdminDate("44927")).toBe("2023-01-01");
  });
  it("refuses what is not a date", () => {
    expect(parseEdAdminDate("")).toBeNull();
    expect(parseEdAdminDate("31/02/2020")).toBeNull();
    expect(parseEdAdminDate("13/13/2020")).toBeNull();
    expect(parseEdAdminDate("soon")).toBeNull();
    expect(parseEdAdminDate("1/1/1899")).toBeNull();
  });
});

describe("students", () => {
  it("maps their headers and the usual spellings, and names what is missing", () => {
    const m = mapStudentHeaders([...STUDENT_COLUMNS]);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual([]);
    expect(m.map[0]).toBe("familycode");
    expect(m.map[STUDENT_COLUMNS.indexOf("Date of Birth*")]).toBe("dateofbirth");
    const alt = mapStudentHeaders(["Family/Sponsor Code", "Surname", "Name", "Stage", "DOB", "Sex", "Shoe size"]);
    expect(alt.map).toEqual(["familycode", "lastname", "firstname", "grade", "dateofbirth", "gender", null]);
    expect(alt.unknown).toEqual(["Shoe size"]);
    expect(mapStudentHeaders(["First Name", "Grade"]).missing).toEqual(["familycode", "lastname", "dateofbirth"]);
  });

  it("finds the students sheet in a workbook and knows the file's kind", () => {
    const tables: Table[] = [
      { name: "Notes", headers: ["Anything"], rows: [] },
      { name: "Sheet1", headers: [...STUDENT_COLUMNS], rows: [studentRow()] },
    ];
    expect(findStudentTable(tables)?.name).toBe("Sheet1");
    expect(detectEdAdminKind(tables)).toBe("ed_admin_students");
    expect(detectEdAdminKind([{ name: "Basic", headers: [...BASIC_COLUMNS], rows: [] }])).toBe("ed_admin_parents");
    expect(detectEdAdminKind([{ name: "x", headers: ["first_name", "last_name", "email"], rows: [] }])).toBeNull();
  });

  it("builds a student from their row, campus and stage read off the grade name", () => {
    const { map } = mapStudentHeaders([...STUDENT_COLUMNS]);
    const v = validateStudentRow(map, studentRow(), grades);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.warnings).toEqual([]);
    expect(v.record).toMatchObject({
      family_code: "COE0001",
      admission_number: "HBS-2026-00019",
      grade_code: "Stage5-HPS",
      campus_id: "c-hps",
      campus_name: "Block 7",
      grade_id: "g-s5",
      first_name: "Abigail",
      middle_names: "Rose",
      last_name: "Coetzer",
      preferred_name: "Abi",
      gender: "female",
      date_of_birth: "2020-09-09",
      nationality: "Motswana",
      country_of_birth: "Botswana",
      identity_number: "123456789",
      home_language: "Setswana",
      previous_school: "Little Acorns",
      date_of_entry: "2027-01-11",
      status: "active",
    });
  });

  it("refuses an unmapped grade, a missing birthday and an unknown status, and warns about the rest", () => {
    const { map } = mapStudentHeaders([...STUDENT_COLUMNS]);
    const bad = validateStudentRow(map, studentRow({ "Grade*": "Stage 5", "Date of Birth*": "", Status: "Applicant" }), grades);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join(" ")).toMatch(/"Stage 5" is not mapped/);
    expect(bad.errors.join(" ")).toMatch(/Date of birth is missing/);
    expect(bad.errors.join(" ")).toMatch(/"Applicant" is not one/);
    const soft = validateStudentRow(map, studentRow({ "Gender*": "X", "Date of Entry*": "next term", Status: "" }), grades);
    expect(soft.ok).toBe(true);
    if (!soft.ok) return;
    expect(soft.record.gender).toBeNull();
    expect(soft.record.date_of_entry).toBeNull();
    expect(soft.warnings).toHaveLength(3);
  });

  it("reads their statuses", () => {
    expect(studentStatusFrom("Current")).toEqual({ status: "active" });
    expect(studentStatusFrom("Graduated")).toEqual({ status: "graduated" });
    expect(studentStatusFrom("Left")).toEqual({ status: "left" });
    expect(studentStatusFrom("Withdrawn")).toEqual({ status: "left" });
    expect("error" in studentStatusFrom("Applicant")).toBe(true);
    expect(genderFrom("Female")).toBe("female");
    expect(genderFrom("m")).toBe("male");
    expect(genderFrom("other")).toBeNull();
  });

  it("spots the same admission number or the same child twice in a file", () => {
    const { map } = mapStudentHeaders([...STUDENT_COLUMNS]);
    const rows = [studentRow(), studentRow({ "First Name*": "Ben", "Admission Number*": "HBS-2026-00019" }), studentRow({ "Admission Number*": "" }), studentRow({ "Admission Number*": "", "First Name*": "Cara" })];
    const verdicts = rows.map((r, index) => ({ index, v: validateStudentRow(map, r, grades) }));
    const dups = duplicateStudentsWithinFile(verdicts.flatMap(({ index, v }) => (v.ok ? [{ index, record: v.record }] : [])));
    expect(dups.get(1)).toMatch(/Same admission number as row 1/);
    expect(dups.get(2)).toMatch(/Same child as row 1/);
    expect(dups.has(3)).toBe(false);
  });
});

/** Their parent workbook: the sheets the export writes, for one family with two guardians and one with one. */
function parentTables(): Table[] {
  const basic = (code: string, g1: string[], g2: string[]) => [code, ...g1, ...g2, "Setswana", "", "", "", "Current", "Mr and Mrs Coetzer"];
  return [
    {
      name: "Basic",
      headers: [...BASIC_COLUMNS],
      rows: [
        basic("COE0001", ["Coetzer", "Jan", "Mr", "Father", "M"], ["Coetzer", "Anna", "Mrs", "Mother", "F"]),
        basic("MOL0002", ["Molefe", "Kago", "Ms", "Guardian (female)", "F"], ["", "", "", "", ""]),
        basic("", ["Nobody", "No", "", "", ""], ["", "", "", "", ""]),
      ],
    },
    {
      name: "G1 Contact",
      headers: [...G1_CONTACT_COLUMNS],
      rows: [
        ["COE0001", "Coetzer", "Jan", "3901234", "71234567", "jan@example.com", "", "", "", "", "Motswana", "", "", "Mr Jan Coetzer"],
        ["MOL0002", "Molefe", "Kago", "", "0821234567", "KAGO@Example.com", "", "", "", "", "", "", "", ""],
      ],
    },
    {
      name: "G1 Address",
      headers: [...G1_ADDRESS_COLUMNS],
      rows: [["COE0001", "Coetzer", "Jan", "Plot 123", "Block 7", "Gaborone", "", "", "", "", "", "", "", "Gogo Coetzer", "Grandmother", "71000000", "", "", "", "", "", ""]],
    },
    {
      name: "G2 Contact",
      headers: [...G2_CONTACT_COLUMNS],
      rows: [["COE0001", "Coetzer", "Anna", "", "72345678", "", "", "", "", "", "", "", "", ""]],
    },
    {
      name: "G2 Address",
      headers: [...G2_ADDRESS_COLUMNS],
      rows: [["COE0001", "Coetzer", "Anna", "Plot 123", "Block 7", "Gaborone", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]],
    },
    { name: "Accounts (By Family Code)", headers: ["Family/SponsorCode*", "Invoice(1/2/E)*"], rows: [["COE0001", "1"]] },
    { name: "Instructions", headers: ["Read me"], rows: [["Do not edit the headers"]] },
  ];
}

describe("parents", () => {
  it("merges their sheets into one record per family code", () => {
    const report = mergeParentTables(parentTables());
    expect(report.skippedSheets).toEqual(["Instructions"]);
    expect(report.rowsWithoutCode).toEqual([{ sheet: "Basic", rows: 1 }]);
    expect(report.families.map((f) => f.code)).toEqual(["COE0001", "MOL0002"]);
    const coe = report.families[0];
    expect(coe.sheets).toEqual(["Basic", "G1 Contact", "G1 Address", "G2 Contact", "G2 Address", "Accounts (By Family Code)"]);
    expect(coe.fields.get("g1email")).toBe("jan@example.com");
    expect(coe.fields.get("g2cell")).toBe("72345678");
    expect(coe.fields.get("g2addr1")).toBe("Plot 123");
    expect(coe.firstRow).toEqual({ sheet: "Basic", row: 1 });
  });

  it("builds a family with two guardians, the one with an email first", () => {
    const [coe] = mergeParentTables(parentTables()).families;
    const v = validateParentRecord(coe);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.record.family_code).toBe("COE0001");
    expect(v.record.family_name).toBe("Coetzer");
    expect(v.record.home_language).toBe("Setswana");
    expect(v.record.address).toBe("Plot 123, Block 7, Gaborone");
    expect(v.record.primary_index).toBe(0);
    expect(v.record.guardians).toHaveLength(2);
    expect(v.record.guardians[0]).toMatchObject({
      first_name: "Jan", last_name: "Coetzer", title: "Mr", relationship: "father", gender: "M",
      email: "jan@example.com", email_normalised: "jan@example.com", mobile: "71234567", mobile_normalised: "+26771234567", nationality: "Motswana",
    });
    expect(v.record.guardians[1]).toMatchObject({ first_name: "Anna", relationship: "mother", gender: "F", email: null, mobile_normalised: "+26772345678", address: "Plot 123, Block 7, Gaborone" });
    expect(v.record.notes).toContain("Also in Ed-admin: Mrs Anna Coetzer (Mother), 72345678, no email address.");
    expect(v.record.notes).toContain("Emergency contact: Gogo Coetzer (Grandmother), 71000000");
    expect(v.warnings.join(" ")).toMatch(/Anna Coetzer has no email address/);
  });

  it("reads a single guardian, a South African number and a guardian relation", () => {
    const [, mol] = mergeParentTables(parentTables()).families;
    const v = validateParentRecord(mol);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.record.guardians).toHaveLength(1);
    expect(v.record.guardians[0]).toMatchObject({ relationship: "guardian", gender: "F", email_normalised: "kago@example.com", mobile_normalised: "+27821234567" });
    expect(v.record.notes).toBeNull();
    expect(v.warnings).toEqual([]);
  });

  it("refuses a family with no email address on either guardian", () => {
    const fields = new Map([["g1lastname", "Dube"], ["g1firstname", "Thato"], ["g1cell", "71111111"]]);
    const v = validateParentRecord({ code: "DUB0003", fields, sheets: ["Basic"], firstRow: { sheet: "Basic", row: 1 } });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toMatch(/Neither guardian has an email address/);
  });

  it("reads a flat single-sheet export with the compact G2 names", () => {
    const flat: Table = {
      name: "Report",
      headers: ["Family Code", "G1 First Name", "G1 Surname", "G1 Email", "G2FName", "G2LName", "G2 Email", "G2 Relation", "Record Status"],
      rows: [["abc0009", "Neo", "Kgosi", "bad-email", "Lesego", "Kgosi", "lesego@example.com", "Step-mother", "Archived"]],
    };
    const [fam] = mergeParentTables([flat]).families;
    expect(fam.code).toBe("ABC0009");
    const v = validateParentRecord(fam);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.record.primary_index).toBe(1);
    expect(v.record.guardians[1].relationship).toBe("mother");
    expect(v.warnings.join(" ")).toMatch(/"bad-email" is not an email address/);
    expect(v.warnings.join(" ")).toMatch(/Record status is "Archived"/);
  });

  it("maps their relations into our words", () => {
    expect(relationshipFrom("Mother")).toBe("mother");
    expect(relationshipFrom("Step-father")).toBe("father");
    expect(relationshipFrom("Grandmother")).toBe("grandparent");
    expect(relationshipFrom("Primary Guardian (male)")).toBe("guardian");
    expect(relationshipFrom("Self Sponsor")).toBe("guardian");
    expect(relationshipFrom("")).toBe("parent");
    expect(relationshipFrom("Aunt")).toBe("other");
  });

  it("spots two family codes sharing an email or a number", () => {
    const mk = (code: string, email: string, cell: string) => {
      const fields = new Map([["g1lastname", "X"], ["g1firstname", "Y"], ["g1email", email], ["g1cell", cell]]);
      const v = validateParentRecord({ code, fields, sheets: [], firstRow: { sheet: "Basic", row: 1 } });
      if (!v.ok) throw new Error(v.errors.join(" "));
      return v.record;
    };
    const dups = duplicateParentsWithinFile([
      { index: 0, record: mk("A1", "a@example.com", "71111111") },
      { index: 1, record: mk("A2", "A@example.com", "72222222") },
      { index: 2, record: mk("A3", "c@example.com", "71111111") },
      { index: 3, record: mk("A4", "d@example.com", "74444444") },
    ]);
    expect(dups.get(1)).toMatch(/Same email address as family A1/);
    expect(dups.get(2)).toMatch(/Same mobile number as family A1/);
    expect(dups.has(3)).toBe(false);
  });
});
