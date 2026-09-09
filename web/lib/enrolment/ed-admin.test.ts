import { describe, expect, it } from "vitest";
import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";
import {
  addressLines,
  formatDate,
  parentRow,
  PARENT_COLUMNS,
  phoneFor,
  studentRow,
  STUDENT_COLUMNS,
} from "@/lib/enrolment/ed-admin";

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

describe("the school's own column lists", () => {
  it("has the parent columns their template has, in order", () => {
    expect(PARENT_COLUMNS).toHaveLength(96);
    expect(PARENT_COLUMNS[0]).toBe("Family Code*");
    expect(PARENT_COLUMNS[1]).toBe("G1 Last Name");
    expect(PARENT_COLUMNS[35]).toBe("G2 Last Name");
    // Their spelling, not ours. Correcting it would break their importer.
    expect(PARENT_COLUMNS).toContain("G1 Slautation");
    expect(PARENT_COLUMNS).toContain("G2 Slautation");
    expect(PARENT_COLUMNS.at(-1)).toBe("DO Acc. Name");
    expect(new Set(PARENT_COLUMNS).size).toBe(PARENT_COLUMNS.length);
  });

  it("has the student columns their template has, in order", () => {
    expect(STUDENT_COLUMNS).toHaveLength(33);
    expect(STUDENT_COLUMNS[0]).toBe("Family Code*");
    expect(STUDENT_COLUMNS[1]).toBe("Admission Number*");
    expect(STUDENT_COLUMNS.at(-1)).toBe("Status");
    expect(new Set(STUDENT_COLUMNS).size).toBe(STUDENT_COLUMNS.length);
  });

  it("gives every row exactly as many values as there are columns", () => {
    expect(parentRow(record, "COE1")).toHaveLength(PARENT_COLUMNS.length);
    expect(studentRow(record, "COE1")).toHaveLength(STUDENT_COLUMNS.length);
    // And an empty record still lines up, rather than shifting every field.
    const bare = { ...record, guardians: [], emergency_contacts: [] };
    expect(parentRow(bare, "XXX1")).toHaveLength(PARENT_COLUMNS.length);
  });
});

describe("parents and students stay apart", () => {
  const parent = parentRow(record, "COE1");
  const student = studentRow(record, "COE1");

  it("keeps the child out of the parent file", () => {
    const text = parent.join("");
    for (const leak of ["Abigail", "Abi", "2020-09-09", "09/09/2020", "Stage 1", "HBS-2026-00019", "Little Acorns"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("keeps the parents out of the student file", () => {
    const text = student.join("");
    for (const leak of ["Sanet", "Pieter", "sanet@example.com", "+26774809801", "Plot 123", "Marie", "Botha"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("ties the two together on the family code, and only deliberately", () => {
    expect(parent[0]).toBe("COE1");
    expect(student[0]).toBe("COE1");
    // Any other value in both files has to be one that genuinely belongs in
    // each of them on its own: the shared surname, the shared nationality and
    // language, and a town that is both where the mother lives and where the
    // child was born. Anything else appearing here is a leak.
    const shared = parent.filter((v) => v && student.includes(v));
    expect(new Set(shared)).toEqual(new Set(["COE1", "Coetzer", "Motswana", "Setswana", "Gaborone"]));
  });

  it("gives siblings the same code, so one account carries both", () => {
    const sibling = { ...record, application: { ...record.application, reference: "HBS-2026-00031" } };
    expect(studentRow(sibling, "COE1")[0]).toBe(studentRow(record, "COE1")[0]);
    expect(parentRow(sibling, "COE1")).toEqual(parentRow(record, "COE1"));
  });
});

describe("the fields themselves", () => {
  it("writes phone numbers as their template does — digits, no plus", () => {
    // A leading + would be prefixed with an apostrophe by the CSV writer, to
    // stop a spreadsheet running it as a formula, and that apostrophe would
    // land in their database.
    expect(phoneFor("+26774809801")).toBe("74809801");
    expect(phoneFor("+267 74 809 801")).toBe("74809801");
    expect(phoneFor("74809801")).toBe("74809801");
    expect(phoneFor("3901234")).toBe("3901234");
    // Another country keeps its code; without it the number is unreachable.
    expect(phoneFor("+27821234567")).toBe("27821234567");
    expect(phoneFor(null)).toBe("");
    for (const p of [phoneFor("+26774809801"), phoneFor("+27821234567")]) {
      expect(p.startsWith("+")).toBe(false);
    }
  });

  it("puts no phone number in the file with a leading plus", () => {
    for (const v of [...parentRow(record, "COE1"), ...studentRow(record, "COE1")]) {
      expect(v.startsWith("+")).toBe(false);
    }
  });

  it("writes dates the way their template holds them", () => {
    expect(formatDate("2020-09-09")).toBe("09/09/2020");
    expect(formatDate("2020-09-09", "ymd")).toBe("2020/09/09");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });

  it("splits one address into their four lines, losing nothing", () => {
    expect(addressLines("Plot 123\nExtension 12\nGaborone")).toEqual(["Plot 123", "Extension 12", "Gaborone", ""]);
    expect(addressLines(null)).toEqual(["", "", "", ""]);
    expect(addressLines("a, b, c, d, e")).toEqual(["a", "b", "c", "d, e"]);
  });

  it("puts the family's emergency contacts under the first guardian", () => {
    const row = parentRow(record, "COE1");
    const at = (name: string) => row[PARENT_COLUMNS.indexOf(name)];
    expect(at("G1 Emerg. Name 1")).toBe("Marie Botha");
    expect(at("G1 Emerg. Rel. 1")).toBe("aunt");
    expect(at("G1 Emerg. Cont. 1")).toBe("71234567");
    expect(at("G2 Emerg. Name 1")).toBe("");
  });

  it("fills the student columns their system insists on", () => {
    const row = studentRow(record, "COE1");
    const at = (name: string) => row[STUDENT_COLUMNS.indexOf(name)];
    expect(at("Admission Number*")).toBe("HBS-2026-00019");
    expect(at("Grade*")).toBe("Stage 1");
    expect(at("Last Name*")).toBe("Coetzer");
    expect(at("First Name*")).toBe("Abigail");
    expect(at("Gender*")).toBe("F");
    expect(at("Date of Birth*")).toBe("09/09/2020");
    expect(at("Date of Entry*")).toBe("11/01/2027");
  });
});
