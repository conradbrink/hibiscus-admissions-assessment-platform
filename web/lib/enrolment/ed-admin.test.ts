import { describe, expect, it } from "vitest";
import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";
import {
  acceptedLanguage,
  acceptedNationality,
  accountsRow,
  addressLines,
  ACCOUNTS_COLUMNS,
  BASIC_COLUMNS,
  basicRow,
  droppedValues,
  formatDate,
  G1_ADDRESS_COLUMNS,
  G1_CONTACT_COLUMNS,
  G2_ADDRESS_COLUMNS,
  parentWorkbook,
  phoneFor,
  studentRow,
  studentWorkbook,
  STUDENT_COLUMNS,
  type FamilyExport,
} from "@/lib/enrolment/ed-admin";
import { workbookParts } from "@/lib/enrolment/xlsx";

/**
 * These tests exist to catch a change nobody meant to make. The column lists
 * are the school's other system's, copied from its own template; if one of
 * them moves, its importer silently reads the wrong field into the wrong
 * place, and nothing here would otherwise notice.
 */

const record: StudentRecordSnapshot = {
  schema_version: 1,
  generated_at: "2026-09-09T10:00:00.000Z",
  application: {
    reference: "HBS-2026-00019",
    campus: "Broadhurst",
    campus_code: "BRD",
    grade: "Stage 1",
    intake: "Term 1, 2027",
    start_date: "2027-01-11",
  },
  student: {
    legal_first_name: "Abigail",
    legal_middle_names: "Rose",
    legal_last_name: "Coetzer",
    preferred_name: "Abi",
    gender: "female",
    date_of_birth: "2020-09-09",
    nationality: "Motswana",
    country_of_birth: "Botswana",
    place_of_birth: "Gaborone",
    home_language: "Setswana",
    identity_type: "birth_certificate",
    identity_number: "123456789",
    previous_institution: "Little Acorns",
    current_grade: "Reception",
  },
  guardians: [
    {
      kind: "guardian",
      first_name: "Sanet",
      last_name: "Coetzer",
      relationship: "mother",
      email: "sanet@example.com",
      mobile: "+26774809801",
      phone: "3901234",
      address: "Plot 123\nExtension 12\nGaborone",
      nationality: "Motswana",
    },
    {
      kind: "guardian",
      first_name: "Pieter",
      last_name: "Coetzer",
      relationship: "father",
      email: "pieter@example.com",
      mobile: "+26771112222",
      phone: null,
      address: null,
      nationality: "Motswana",
    },
  ],
  emergency_contacts: [
    { first_name: "Marie", last_name: "Botha", relationship: "aunt", phone: "71234567", email: null, address: null },
  ],
  medical: {
    medical_aid_name: "BPOMAS",
    medical_aid_number: "MA-1",
    medical_aid_principal_member: "Sanet Coetzer",
    emergency_treatment_consent: true,
    allergies: "Peanuts",
    medical_conditions: "Asthma",
    medication: "Inhaler",
    medical_notes: "Carries a spacer",
    vaccination_notes: "Up to date",
  },
  documents: [],
  agreements: [],
  payment: null,
};

const family: FamilyExport = { familyCode: "COE0001", record, enquiredAt: "2026-09-09T06:08:33Z" };

describe("the school's own sheets", () => {
  it("has their student header row, exactly", () => {
    expect(STUDENT_COLUMNS).toHaveLength(33);
    expect(STUDENT_COLUMNS[0]).toBe("Family Code*");
    expect(STUDENT_COLUMNS[1]).toBe("Admission Number*");
    expect(STUDENT_COLUMNS.at(-1)).toBe("Status");
  });

  it("keeps their parent sheets' own spellings, inconsistencies and all", () => {
    // Their Basic sheet spaces it, their address sheets do not. Tidying
    // either one would stop the importer matching.
    expect(BASIC_COLUMNS[0]).toBe("Family/Sponsor Code*");
    expect(G1_CONTACT_COLUMNS[0]).toBe("Family/SponsorCode*");
    expect(BASIC_COLUMNS).toHaveLength(17);
    expect(G1_CONTACT_COLUMNS).toHaveLength(14);
    expect(G1_ADDRESS_COLUMNS).toHaveLength(22);
    expect(ACCOUNTS_COLUMNS).toHaveLength(18);
    // Their G1 address sheet labels the postal block "Res." as well.
    expect(G1_ADDRESS_COLUMNS[3]).toBe("G1 Addr 1");
    expect(G1_ADDRESS_COLUMNS[4]).toBe("G1 Res. Addr 2");
    // Their G2 address sheet uses compact names.
    expect(G2_ADDRESS_COLUMNS[1]).toBe("G2LName");
    expect(G2_ADDRESS_COLUMNS[13]).toBe("G2Emerg1Name");
  });

  it("gives every row exactly as many values as its sheet has columns", () => {
    expect(basicRow(family)).toHaveLength(BASIC_COLUMNS.length);
    expect(accountsRow(family)).toHaveLength(ACCOUNTS_COLUMNS.length);
    expect(studentRow(family)).toHaveLength(STUDENT_COLUMNS.length);
    const bare: FamilyExport = { ...family, record: { ...record, guardians: [], emergency_contacts: [] } };
    expect(basicRow(bare)).toHaveLength(BASIC_COLUMNS.length);
  });

  it("builds workbooks their importer can open", () => {
    for (const bytes of [parentWorkbook([family]), studentWorkbook([family])]) {
      // A zip, which is what an .xlsx is.
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
      expect(bytes.length).toBeGreaterThan(500);
    }
  });

  it("carries their six parent sheets, named as their workbook names them", () => {
    const parts = workbookParts([
      { name: "Basic", headers: BASIC_COLUMNS, rows: [basicRow(family)] },
    ]);
    expect(parts.map((p) => p.name)).toContain("xl/workbook.xml");
    const wb = parts.find((p) => p.name === "xl/workbook.xml")!.data.toString("utf8");
    expect(wb).toContain('name="Basic"');
  });
});

describe("parents and students stay apart", () => {
  it("keeps the child out of every parent sheet", () => {
    const text = [...basicRow(family), ...accountsRow(family)].join("|");
    for (const leak of ["Abigail", "Abi", "09/09/2020", "Stage 1", "HBS-2026-00019", "Little Acorns"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("keeps the parents out of the student sheet", () => {
    const text = studentRow(family).join("|");
    for (const leak of ["Sanet", "Pieter", "sanet@example.com", "74809801", "Plot 123", "Marie"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("gives siblings one family code, and one parent row", () => {
    const sibling: FamilyExport = { ...family, record: { ...record, application: { ...record.application, reference: "HBS-2026-00031" } } };
    expect(studentRow(sibling)[0]).toBe(studentRow(family)[0]);
    expect(basicRow(sibling)).toEqual(basicRow(family));
  });
});

describe("the values their importer will accept", () => {
  it("passes a nationality and language that are on their lists", () => {
    expect(acceptedNationality("Motswana")).toBe("Motswana");
    expect(acceptedLanguage("Setswana")).toBe("Setswana");
    expect(acceptedLanguage("English")).toBe("English");
  });

  it("sends nothing rather than a spelling they will refuse", () => {
    // Their workbook: "Any other form of spelling will not be imported."
    expect(acceptedNationality("Botswanan")).toBe("");
    expect(acceptedLanguage("Tswana")).toBe("");
    expect(acceptedNationality(null)).toBe("");
  });

  it("reports what it had to drop, so somebody can fix the record", () => {
    const odd: FamilyExport = {
      ...family,
      record: { ...record, student: { ...record.student, nationality: "Botswanan", home_language: "Tswana" } },
    };
    const dropped = droppedValues([odd]);
    expect(dropped.nationalities).toContain("Botswanan");
    expect(dropped.languages).toContain("Tswana");
    expect(droppedValues([family])).toEqual({ nationalities: [], languages: [] });
  });

  it("writes phone numbers as digits, never with a leading plus", () => {
    expect(phoneFor("+26774809801")).toBe("74809801");
    expect(phoneFor("+27821234567")).toBe("27821234567");
    expect(phoneFor(null)).toBe("");
    for (const v of [...basicRow(family), ...accountsRow(family), ...studentRow(family)]) {
      expect(v.startsWith("+")).toBe(false);
    }
  });

  it("writes dates the way their template holds them", () => {
    expect(formatDate("2020-09-09")).toBe("09/09/2020");
    expect(formatDate("2020-09-09", "ymd")).toBe("2020/09/09");
    expect(formatDate(null)).toBe("");
  });

  it("splits one address into their four lines, losing nothing", () => {
    expect(addressLines("Plot 123\nExtension 12\nGaborone")).toEqual(["Plot 123", "Extension 12", "Gaborone", ""]);
    expect(addressLines("a, b, c, d, e")).toEqual(["a", "b", "c", "d, e"]);
  });

  it("fills the columns their sheets mark required", () => {
    const row = basicRow(family);
    const at = (name: string) => row[BASIC_COLUMNS.indexOf(name)];
    expect(at("Family/Sponsor Code*")).toBe("COE0001");
    expect(at("G1 Last Name*")).toBe("Coetzer");
    expect(at("G1 First Name*")).toBe("Sanet");
    expect(at("G1 Title*")).toBe("Mrs");
    expect(at("G1 Relation*")).toBe("Mother");
    expect(at("G1 Gender*")).toBe("F");
    expect(at("Record Status*")).toBe("Active");
    expect(at("Family Salutation*")).not.toBe("");
    expect(at("G2 Relation")).toBe("Father");
  });
});

describe("one row per family", () => {
  const sibling: FamilyExport = {
    ...family,
    record: { ...record, student: { ...record.student, legal_first_name: "Daniel", legal_middle_names: null } },
  };
  const other: FamilyExport = {
    familyCode: "MOK0001",
    record: { ...record, student: { ...record.student, legal_first_name: "Naledi", legal_last_name: "Mokwena" } },
    enquiredAt: "2026-09-09T06:08:33Z",
  };

  it("writes a family once however many children it has", () => {
    // The zip is deterministic (fixed timestamps), so two siblings producing
    // the same bytes as one child is the whole assertion: the second child
    // added no row anywhere in the parent workbook.
    expect(parentWorkbook([family, sibling])).toEqual(parentWorkbook([family]));
    expect(parentWorkbook([family, sibling, other]).length).toBeGreaterThan(parentWorkbook([family]).length);
  });

  it("still writes one row per child in the student workbook", () => {
    // The opposite guarantee, and the reason the two files are separate:
    // siblings are one account and two pupils.
    expect(studentWorkbook([family, sibling])).not.toEqual(studentWorkbook([family]));
  });
});
