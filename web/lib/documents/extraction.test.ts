import { describe, expect, it } from "vitest";
import { compareExtraction, documentReadingOutcome, mismatchFlags, mismatchText, normaliseText, parseMismatchFlags, type RegistrationFacts } from "@/lib/documents/compare";
import { BIRTH_CERTIFICATE_SCHEMA, devOutputFor, isExtractable, SCHOOL_REPORT_SCHEMA, schemaFor, systemPromptFor } from "@/lib/documents/extraction-schemas";

const registration = {
  legal_first_name: "Thato",
  legal_middle_names: "Neo",
  legal_last_name: "Moyo",
  date_of_birth: "2017-04-15",
  place_of_birth: "Gaborone",
  gender: "female",
  previous_institution: "Broadhurst Primary School",
  current_grade: "Standard 3",
};

describe("extraction schemas", () => {
  it("accept a full and a mostly-null reading", () => {
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse({ first_names: "Thato Neo", last_name: "Moyo", date_of_birth: "2017-04-15", place_of_birth: "Gaborone", sex: "female", registration_number: "GB/2017/1234", confidence: 0.9 }).success).toBe(true);
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse({ first_names: null, last_name: null, date_of_birth: null, place_of_birth: null, sex: null, registration_number: null, confidence: 0.1 }).success).toBe(true);
  });
  it("reject a date that is not ISO and a confidence out of range", () => {
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse({ first_names: null, last_name: null, date_of_birth: "15/04/2017", place_of_birth: null, sex: null, registration_number: null, confidence: 0.5 }).success).toBe(false);
    expect(SCHOOL_REPORT_SCHEMA.safeParse({ institution_name: null, student_name: null, grade_or_year: null, academic_year: null, confidence: 1.5 }).success).toBe(false);
  });
  it("only name the document kinds that are read; medical is never one of them", () => {
    expect(isExtractable("birth_certificate")).toBe(true);
    expect(isExtractable("medical_special_needs")).toBe(false);
    expect(schemaFor("transfer_certificate")).toBe(SCHOOL_REPORT_SCHEMA);
  });
  it("dev outputs satisfy their schemas", () => {
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse(devOutputFor("birth_certificate")).success).toBe(true);
    expect(SCHOOL_REPORT_SCHEMA.safeParse(devOutputFor("school_report")).success).toBe(true);
  });
  it("the prompt forbids inference and comment", () => {
    const p = systemPromptFor("birth_certificate");
    expect(p).toMatch(/Never infer/);
    expect(p).toMatch(/Do not describe, assess or comment/);
  });
});

describe("compareExtraction", () => {
  it("agrees when the document matches, ignoring case, accents and middle names", () => {
    const c = compareExtraction(registration, { first_names: "THATO", last_name: "Moyó", date_of_birth: "2017-04-15", place_of_birth: "Gaborone, Botswana", sex: "female", registration_number: "x" }, "birth_certificate");
    expect(c.map((x) => x.match)).toEqual(["same", "same", "same", "same", "same"]);
  });
  it("flags a different date of birth and surname", () => {
    const c = compareExtraction(registration, { first_names: "Thato Neo", last_name: "Moyowe", date_of_birth: "2017-04-16", place_of_birth: null, sex: "female", registration_number: null }, "birth_certificate");
    const byField = Object.fromEntries(c.map((x) => [x.field, x.match]));
    expect(byField.legal_last_name).toBe("differs");
    expect(byField.date_of_birth).toBe("differs");
    expect(byField.place_of_birth).toBe("unverified");
    const flags = mismatchFlags(c, "birth_certificate", "doc-1");
    expect(flags.map((f) => f.field)).toEqual(["legal_last_name", "date_of_birth"]);
    expect(mismatchText(flags)).toContain("Date of birth: the birth certificate shows 2017-04-16; the form says 2017-04-15");
  });
  it("never compares gender when the form says other or undisclosed", () => {
    const c = compareExtraction({ ...registration, gender: "undisclosed" }, { sex: "male" }, "birth_certificate");
    expect(c.find((x) => x.field === "gender")?.match).toBe("unverified");
  });
  it("matches a school by its distinctive words and a student by first and last name", () => {
    const c = compareExtraction(registration, { institution_name: "Broadhurst Primary", student_name: "Moyo, Thato N.", grade_or_year: "Std 3", academic_year: "2025" }, "school_report");
    const byField = Object.fromEntries(c.map((x) => [x.field, x.match]));
    expect(byField.previous_institution).toBe("same");
    expect(byField.full_name).toBe("same");
    expect(byField.current_grade).toBe("differs");
  });
  it("treats a blank registration as unverified, never as a difference", () => {
    const c = compareExtraction({ ...registration, previous_institution: null, legal_first_name: null }, { institution_name: "X", student_name: "Y Z", grade_or_year: null, academic_year: null }, "transfer_certificate");
    expect(c.every((x) => x.match === "unverified")).toBe(true);
  });
  it("returns nothing for a kind it does not read", () => {
    expect(compareExtraction(registration, { anything: "x" }, "medical_special_needs")).toEqual([]);
  });
  describe("a name that cannot be compared by machine", () => {
    const blank = { first_names: null, last_name: null, date_of_birth: null, place_of_birth: null, sex: null };
    const chinese: RegistrationFacts = { ...registration, legal_first_name: "伟", legal_middle_names: null, legal_last_name: "王" };
    const birth = (reg: RegistrationFacts, fields: Record<string, string | null>) =>
      Object.fromEntries(compareExtraction(reg, { ...blank, ...fields }, "birth_certificate").map((x) => [x.field, x.match]));

    it("is unreadable, not the same, when neither side has Latin letters", () => {
      // Both used to fold to "" and compare as "same": no flag and no task
      // for a certificate in another child's name.
      expect(birth(chinese, { first_names: "娜", last_name: "李" })).toMatchObject({ legal_first_name: "unreadable", legal_last_name: "unreadable" });
      const report = compareExtraction(chinese, { institution_name: null, student_name: "李娜", grade_or_year: null, academic_year: null }, "school_report");
      expect(report.find((x) => x.field === "full_name")?.match).toBe("unreadable");
    });

    it("is unreadable, not a difference, when the document is in another script", () => {
      // This used to flag the parent's form over a translation.
      const latin = { ...registration, legal_middle_names: null };
      expect(birth(latin, { first_names: "Тато", last_name: "Мойо" })).toMatchObject({ legal_first_name: "unreadable", legal_last_name: "unreadable" });
    });

    it("does not let a Latin middle name stand in for a first name it cannot read", () => {
      expect(birth({ ...chinese, legal_middle_names: "Neo" }, { first_names: "Neo" }).legal_first_name).toBe("unreadable");
    });

    it("still compares a document that prints the name in two scripts", () => {
      const latin = { ...registration, legal_middle_names: null };
      expect(birth(latin, { first_names: "Thato 塔托", last_name: "Moyo 莫约" })).toMatchObject({ legal_first_name: "same", legal_last_name: "same" });
      expect(birth(latin, { last_name: "Dube 莫约" }).legal_last_name).toBe("differs");
    });

    it("opens a task for a person, and never a flag the parent sees", () => {
      const comparisons = compareExtraction(chinese, { ...blank, first_names: "娜", last_name: "李" }, "birth_certificate");
      const flags = mismatchFlags(comparisons, "birth_certificate", "doc-1");
      expect(flags).toEqual([]);
      const outcome = documentReadingOutcome({ childFirstName: "Wei", requirementCode: "birth_certificate", confidence: 0.9, flags, comparisons });
      expect(outcome.tasks.map((t) => t.type)).toEqual(["review_document_unreadable"]);
      expect(outcome.tasks[0].title).toBe("Wei: check the name on the birth certificate by eye");
      expect(outcome.tasks[0].details).toContain("First names: the birth certificate shows 娜; the form says 伟");
      expect(outcome.tasks[0].details).toContain("The parent has not been told");
      expect(outcome.summary).toContain("could not be compared");
    });
  });

  it("words a reading that agrees, and one that differs, as before", () => {
    const agrees = compareExtraction(registration, { first_names: "Thato Neo", last_name: "Moyo", date_of_birth: "2017-04-15", place_of_birth: "Gaborone", sex: "female" }, "birth_certificate");
    const ok = documentReadingOutcome({ childFirstName: "Thato", requirementCode: "birth_certificate", confidence: 0.9, flags: mismatchFlags(agrees, "birth_certificate", "d"), comparisons: agrees });
    expect(ok).toEqual({ summary: "Document read: birth certificate agrees with the registration", tasks: [] });
    const differs = compareExtraction(registration, { first_names: "Thato Neo", last_name: "Dube", date_of_birth: "2017-04-15", place_of_birth: null, sex: null }, "birth_certificate");
    const flags = mismatchFlags(differs, "birth_certificate", "d");
    const out = documentReadingOutcome({ childFirstName: "Thato", requirementCode: "birth_certificate", confidence: 0.9, flags, comparisons: differs });
    expect(out.tasks.map((t) => t.type)).toEqual(["review_document_mismatch"]);
    expect(out.summary).toBe("Document read: birth certificate differs from the registration (surname)");
  });

  it("normalises text predictably and parses flags defensively", () => {
    expect(normaliseText("  Café-Dú  ")).toBe("cafe du");
    expect(parseMismatchFlags(null)).toEqual([]);
    expect(parseMismatchFlags([{ field: "date_of_birth", document_id: "d" }, "junk"])).toHaveLength(1);
  });
});
