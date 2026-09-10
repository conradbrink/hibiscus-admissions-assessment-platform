import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { droppedValues, parentWorkbook, studentWorkbook, type FamilyExport } from "@/lib/enrolment/ed-admin";
import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";

/**
 * Writes the two Ed-admin workbooks with sample families, for a real import
 * run. Not a test of the code so much as a generator that refuses to write a
 * file the importer would reject: the assertions at the end are the check.
 *
 * Set `EDADMIN_SAMPLE_OUT` to say where the files should land; otherwise it
 * makes its own temporary directory and prints the path. It used to name a
 * fixed one, which existed on the machine that wrote it and nowhere else —
 * so CI failed on a directory that had never been there.
 */
function outDir(): string {
  const named = process.env.EDADMIN_SAMPLE_OUT;
  if (named) {
    mkdirSync(named, { recursive: true });
    return named;
  }
  return mkdtempSync(join(tmpdir(), "edadmin-sample-"));
}

type G = StudentRecordSnapshot["guardians"][number];
const guardian = (o: Partial<G> & Pick<G, "first_name" | "last_name" | "relationship">): G => ({
  kind: "primary_guardian", title: null, gender: null, email: null, mobile: null,
  phone: null, address: null, nationality: "Motswana", ...o,
});

const family = (o: {
  code: string; ref: string; grade: string; gradeCode: string; campus: string;
  first: string; middle: string | null; last: string; gender: string; dob: string;
  guardians: G[]; enquired: string; start: string;
}): FamilyExport => ({
  familyCode: o.code,
  enquiredAt: o.enquired,
  externalGradeCode: o.gradeCode,
  record: {
    schema_version: 1,
    generated_at: "2026-09-10T09:00:00Z",
    application: { reference: o.ref, campus: o.campus, campus_code: "HPS", grade: o.grade, intake: "January 2027", start_date: o.start },
    student: {
      legal_first_name: o.first, legal_middle_names: o.middle, legal_last_name: o.last,
      preferred_name: null, gender: o.gender, date_of_birth: o.dob,
      nationality: "Motswana", country_of_birth: "Botswana", place_of_birth: "Gaborone",
      home_language: "English", identity_type: "birth_certificate",
      identity_number: `BC-${o.dob.replace(/-/g, "")}`, previous_institution: "Little Acorns Pre-Primary",
      current_grade: null,
    },
    guardians: o.guardians,
    emergency_contacts: [
      { first_name: "Tebogo", last_name: "Kgosi", relationship: "aunt", phone: "+26773456789", email: "tebogo.kgosi@example.com", address: "Block 8\nGaborone" },
    ],
    medical: {
      medical_aid_name: "BPOMAS", medical_aid_number: "BP-88123", medical_aid_principal_member: `${o.guardians[0].first_name} ${o.guardians[0].last_name}`,
      emergency_treatment_consent: true, allergies: null, medical_conditions: null,
      medication: null, medical_notes: null, vaccination_notes: null,
    },
    documents: [], agreements: [], payment: null,
  },
});

const address = "Plot 2244, Extension 12\nGaborone\nBotswana";

const families: FamilyExport[] = [
  // 1. The ordinary case: a mother, and a second guardian who is the father.
  family({
    code: "COE0001", ref: "HBS-2027-00101", grade: "Stage 2", gradeCode: "Stage2-HPS",
    campus: "Hibiscus International School Block 7", first: "Abigail", middle: "Rose", last: "Coetzer",
    gender: "female", dob: "2019-04-18", enquired: "2026-08-14", start: "2027-01-11",
    guardians: [
      guardian({ kind: "primary_guardian", title: "Mrs", gender: "F", first_name: "Marlene", last_name: "Coetzer", relationship: "mother", email: "marlene.coetzer@example.com", mobile: "+26771234567", phone: "+2673901234", address }),
      guardian({ kind: "second_guardian", title: "Mr", gender: "M", first_name: "Johan", last_name: "Coetzer", relationship: "father", email: "johan.coetzer@example.com", mobile: "+26772345678", address, nationality: "South African" }),
    ],
  }),
  // 2. A sibling: same family code, so the parent sheets must carry one row.
  family({
    code: "COE0001", ref: "HBS-2027-00102", grade: "Reception", gradeCode: "REC-HPS",
    campus: "Hibiscus International School Block 7", first: "Daniel", middle: null, last: "Coetzer",
    gender: "male", dob: "2021-09-02", enquired: "2026-08-14", start: "2027-01-11",
    guardians: [
      guardian({ kind: "primary_guardian", title: "Mrs", gender: "F", first_name: "Marlene", last_name: "Coetzer", relationship: "mother", email: "marlene.coetzer@example.com", mobile: "+26771234567", phone: "+2673901234", address }),
      guardian({ kind: "second_guardian", title: "Mr", gender: "M", first_name: "Johan", last_name: "Coetzer", relationship: "father", email: "johan.coetzer@example.com", mobile: "+26772345678", address, nationality: "South African" }),
    ],
  }),
  // 3. The case that used to export blank: a doctor who is a guardian, with
  //    no relationship that settles the sex either.
  family({
    code: "MOG0002", ref: "HBS-2027-00103", grade: "Stage 5", gradeCode: "Stage5-HPS",
    campus: "Hibiscus International School Block 7", first: "Naledi", middle: "Anne", last: "Mogorosi",
    gender: "female", dob: "2016-02-11", enquired: "2026-08-20", start: "2027-01-11",
    guardians: [
      guardian({ kind: "primary_guardian", title: "Dr", gender: "F", first_name: "Boitumelo", last_name: "Mogorosi", relationship: "guardian", email: "b.mogorosi@example.com", mobile: "+26774567890", address: "Plot 15, Phakalane\nGaborone\nBotswana" }),
    ],
  }),
  // 4. The same shape with the other title that carries no sex.
  family({
    code: "TAU0003", ref: "HBS-2027-00104", grade: "Stage 1", gradeCode: "Stage1-HPS",
    campus: "Hibiscus International School Block 7", first: "Kabelo", middle: null, last: "Tau",
    gender: "male", dob: "2020-11-27", enquired: "2026-08-28", start: "2027-01-11",
    guardians: [
      guardian({ kind: "primary_guardian", title: "Reverend", gender: "M", first_name: "Kelebogile", last_name: "Tau", relationship: "parent", email: "k.tau@example.com", mobile: "+26775678901", address: "Plot 900, Block 9\nGaborone\nBotswana" }),
      guardian({ kind: "second_guardian", title: "Ms", gender: "F", first_name: "Onalenna", last_name: "Tau", relationship: "guardian", email: "o.tau@example.com", mobile: "+26776789012", address: "Plot 900, Block 9\nGaborone\nBotswana" }),
    ],
  }),
  // 5. A grandparent, where the title is what picks Grandmother over
  //    Grandfather, and a pre-school stage at the other campus.
  family({
    code: "SEB0004", ref: "HBS-2027-00105", grade: "Pre-Reception", gradeCode: "PRE-REC-TLK",
    campus: "Hibiscus Bana Tlokweng", first: "Lesego", middle: null, last: "Sebina",
    gender: "female", dob: "2022-06-30", enquired: "2026-09-01", start: "2027-01-11",
    guardians: [
      guardian({ kind: "primary_guardian", title: "Mrs", gender: "F", first_name: "Gaone", last_name: "Sebina", relationship: "grandparent", email: "g.sebina@example.com", mobile: "+26777890123", address: "Ramfurwa Ward\nTlokweng\nBotswana" }),
    ],
  }),
];

describe("sample workbooks for a real Ed-admin import", () => {
  it("writes two files their importer will accept", () => {
    // The generator's own check: anything their lists would refuse is named
    // here, and a file is only worth sending when this is empty.
    const dropped = droppedValues(families);
    expect(dropped).toEqual({ nationalities: [], languages: [], genders: [], relationships: [] });

    const out = outDir();
    writeFileSync(join(out, "edadmin-students-sample.xlsx"), studentWorkbook(families));
    writeFileSync(join(out, "edadmin-parents-sample.xlsx"), parentWorkbook(families));
    // The path is the point: this run produced files someone has to fetch.
    console.log(`Ed-admin sample workbooks written to ${out}`);
    expect(families.length).toBe(5);
  });
});
