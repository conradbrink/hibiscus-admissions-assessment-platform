import { describe, expect, it } from "vitest";
import { applicableAgreements, applicableRequirements, missingDocumentsText, nextStep, registrationCompleteness } from "@/lib/registration/completeness";
import { changedFromApplication } from "@/lib/registration/prefill";
import { familySchema, issuesToFields, signatureMatches, studentSchema } from "@/lib/registration/schema";
import type { AgreementAcceptanceRow, AgreementTemplateRow, DocumentRequirementRow, DocumentRow, RegistrationContactRow, RegistrationRow } from "@/lib/supabase/types";

const req = (code: string, required = true, min: number | null = null): DocumentRequirementRow => ({
  code, label: code, description: null, required, grade_sort_min: min, grade_sort_max: null, sort_order: 0, is_active: true, created_at: "", updated_at: "",
});
const doc = (code: string, review: DocumentRow["review_status"] = "pending"): DocumentRow => ({
  id: code, application_id: "a", requirement_code: code, storage_bucket: "b", storage_path: `p/${code}`, original_filename: "f", mime_type: "application/pdf",
  size_bytes: 1, sha256: "x", uploaded_by: "parent", uploaded_by_staff_id: null, scan_status: "not_scanned", scanner: "none", review_status: review,
  reviewed_by: null, reviewed_at: null, review_note: null, extraction_status: "not_run", extracted_fields: null, extraction_model: null, extraction_error: null, extracted_at: null, superseded_by: null, deleted_at: null,
  uploaded_at: "", created_at: "", updated_at: "",
});
const template = (
  id: string,
  required = true,
  over: Partial<AgreementTemplateRow> = {}
): AgreementTemplateRow => ({ id, key: id, version: 1, name: id, description: null, body_html: "", required, document_url: null, sort_order: 100, is_active: true, created_by: null, created_at: "", updated_at: "", grade_sort_min: null, grade_sort_max: null, may_decline: false, ...over });

const answer = (templateId: string, decision: "accepted" | "declined" = "accepted"): AgreementAcceptanceRow => ({
  id: templateId, application_id: "a", agreement_template_id: templateId, template_key: templateId, template_version: 1,
  body_hash: "h", signature_name: "K M", signature_svg: null, ip_hash: null, user_agent: null, accepted_at: "", decision,
});
const contact = (kind: RegistrationContactRow["kind"]): RegistrationContactRow => ({
  id: kind, application_id: "a", kind, position: 1, contact_id: null, title: "Mrs", gender: "F", first_name: "K", last_name: "M", relationship: "mother", email: null, mobile: null, mobile_normalised: null, phone: null, address: null, nationality: null, created_at: "", updated_at: "",
});
const stamped = (): RegistrationRow =>
  ({
    student_completed_at: "t", medical_completed_at: "t", family_completed_at: "t", emergency_completed_at: "t", documents_completed_at: "t", agreements_completed_at: "t",
  }) as unknown as RegistrationRow;

const requirements = [req("birth_certificate"), req("vaccination_card"), req("school_report", true, 60), req("medical_special_needs", false)];

describe("applicable requirements", () => {
  it("follows the grade band", () => {
    expect(applicableRequirements(requirements, 10).map((r) => r.code)).toEqual(["birth_certificate", "vaccination_card", "medical_special_needs"]);
    expect(applicableRequirements(requirements, 60).map((r) => r.code)).toContain("school_report");
  });
});

describe("which agreements an applicant is asked for", () => {
  // The learner code of conduct is a code a *learner* signs up to. A family
  // registering a baby has no use for rules about uniform and homework, so it
  // starts at Stage 1 (grades.sort_order 60) and everything below that is
  // pre-school.
  const templates = [
    template("learner_code_of_conduct", true, { grade_sort_min: 60, sort_order: 10 }),
    template("fees_policy", true, { sort_order: 30 }),
    template("photography_consent", true, { may_decline: true, sort_order: 50 }),
    template("retired", true, { is_active: false }),
  ];

  it("leaves the code of conduct out of every pre-school grade", () => {
    // Babies 1 through Reception 50, Reception included: it is taught at the
    // pre-school campuses.
    for (const gradeSort of [1, 2, 3, 4, 5, 10, 20, 30, 40, 50]) {
      expect(applicableAgreements(templates, gradeSort).map((t) => t.key)).toEqual(["fees_policy", "photography_consent"]);
    }
  });

  it("asks for it from Stage 1 upward", () => {
    for (const gradeSort of [60, 70, 120, 170]) {
      expect(applicableAgreements(templates, gradeSort).map((t) => t.key)).toContain("learner_code_of_conduct");
    }
  });

  it("never offers a retired agreement, at any grade", () => {
    expect(applicableAgreements(templates, 60).map((t) => t.key)).not.toContain("retired");
  });

  it("keeps them in the order the school set", () => {
    expect(applicableAgreements(templates, 60).map((t) => t.key)).toEqual(["learner_code_of_conduct", "fees_policy", "photography_consent"]);
  });
});

describe("an agreement the parent may refuse", () => {
  const preschool = {
    registration: stamped(),
    contacts: [contact("primary_guardian"), contact("emergency")],
    requirements,
    documents: [doc("birth_certificate"), doc("vaccination_card")],
    gradeSort: 4,
    agreementTemplates: [
      template("learner_code_of_conduct", true, { grade_sort_min: 60 }),
      template("fees_policy"),
      template("photography_consent", true, { may_decline: true }),
    ],
  };

  it("counts a refusal as answered, so the family can finish registering", () => {
    // The point of the whole change: a permission nobody may refuse is not a
    // permission. Declining has to let them through, or the choice is a
    // fiction and the parent simply sits there until they change their mind.
    const c = registrationCompleteness({ ...preschool, acceptances: [answer("fees_policy"), answer("photography_consent", "declined")] });
    expect(c.sections.agreements).toBe(true);
    expect(c.complete).toBe(true);
  });

  it("still refuses to let them skip it", () => {
    const c = registrationCompleteness({ ...preschool, acceptances: [answer("fees_policy")] });
    expect(c.sections.agreements).toBe(false);
    expect(c.missingAgreements.map((t) => t.key)).toEqual(["photography_consent"]);
  });

  it("does not let a refusal stand in for an agreement that must be accepted", () => {
    // A declined fees policy is not a signed fees policy, whatever the row says.
    const c = registrationCompleteness({ ...preschool, acceptances: [answer("fees_policy", "declined"), answer("photography_consent")] });
    expect(c.missingAgreements.map((t) => t.key)).toEqual(["fees_policy"]);
  });

  it("never blocks a pre-school family on the code of conduct", () => {
    const c = registrationCompleteness({ ...preschool, acceptances: [answer("fees_policy"), answer("photography_consent")] });
    expect(c.missingAgreements).toEqual([]);
    expect(c.complete).toBe(true);
    // The same family one grade higher is asked for it, which is what makes
    // the line above mean something.
    const stage1 = registrationCompleteness({ ...preschool, gradeSort: 60, documents: [...preschool.documents, doc("school_report")], acceptances: [answer("fees_policy"), answer("photography_consent")] });
    expect(stage1.missingAgreements.map((t) => t.key)).toEqual(["learner_code_of_conduct"]);
  });
});

describe("completeness", () => {
  const base = { registration: stamped(), contacts: [contact("primary_guardian"), contact("emergency")], requirements, gradeSort: 60, agreementTemplates: [template("policies")], acceptances: [answer("policies")] };

  it("is complete when every section is stamped, required documents are uploaded and agreements accepted", () => {
    const c = registrationCompleteness({ ...base, documents: [doc("birth_certificate"), doc("vaccination_card"), doc("school_report")] });
    expect(c.complete).toBe(true);
    expect(nextStep(c)).toBe("review");
  });
  it("names the required document that is missing and ignores optional ones", () => {
    const c = registrationCompleteness({ ...base, documents: [doc("birth_certificate"), doc("school_report")] });
    expect(c.complete).toBe(false);
    expect(c.missingDocuments.map((d) => d.code)).toEqual(["vaccination_card"]);
    expect(missingDocumentsText(c)).toBe("vaccination_card");
    expect(nextStep(c)).toBe("documents");
  });
  it("treats a rejected document as missing, with its own wording", () => {
    const c = registrationCompleteness({ ...base, documents: [doc("birth_certificate", "rejected"), doc("vaccination_card"), doc("school_report")] });
    expect(c.rejectedDocuments.map((d) => d.code)).toEqual(["birth_certificate"]);
    expect(missingDocumentsText(c)).toBe("birth_certificate (please upload again)");
  });
  it("requires the agreements and the contacts, not just the stamps", () => {
    const c = registrationCompleteness({ ...base, acceptances: [], contacts: [contact("primary_guardian")], documents: [doc("birth_certificate"), doc("vaccination_card"), doc("school_report")] });
    expect(c.sections.agreements).toBe(false);
    expect(c.sections.emergency).toBe(false);
    expect(c.missingAgreements.map((t) => t.key)).toEqual(["policies"]);
  });
  it("with nothing at all, the first step is the student section", () => {
    const c = registrationCompleteness({ ...base, registration: null, contacts: [], documents: [] });
    expect(nextStep(c)).toBe("student");
    expect(missingDocumentsText(c)).toBe("birth_certificate, vaccination_card, school_report");
  });
});

describe("certificate reading prefill", () => {
  it("fills only what the family has not typed, and never the enquiry's names or date", async () => {
    const { applyCertificateReading } = await import("@/lib/registration/prefill");
    const student: Record<string, string> = { legalFirstName: "Naledi", legalMiddleNames: "", legalLastName: "Moeti", dateOfBirth: "2019-04-15", placeOfBirth: "", gender: "", identityType: "", identityNumber: "" };
    const filled = applyCertificateReading(student, {
      fields: { first_names: "Naledi Grace", last_name: "Mokoena", date_of_birth: "2019-04-16", place_of_birth: "Gaborone", sex: "female", registration_number: "BC 12345", confidence: 0.9 },
    });
    expect(student.legalFirstName).toBe("Naledi");
    expect(student.legalLastName).toBe("Moeti");
    expect(student.dateOfBirth).toBe("2019-04-15");
    expect(student.legalMiddleNames).toBe("Grace");
    expect(student.placeOfBirth).toBe("Gaborone");
    expect(student.gender).toBe("female");
    expect(student.identityNumber).toBe("BC 12345");
    expect(student.identityType).toBe("birth_certificate");
    expect(filled.sort()).toEqual(["gender", "identityNumber", "identityType", "legalMiddleNames", "placeOfBirth"]);
  });
  it("does not split middle names off a different first name, and does nothing without a reading", async () => {
    const { applyCertificateReading } = await import("@/lib/registration/prefill");
    const student: Record<string, string> = { legalFirstName: "Naledi", legalMiddleNames: "", identityNumber: "999", identityType: "omang" };
    expect(applyCertificateReading(student, { fields: { first_names: "Grace Naledi", registration_number: "BC 1" } })).toEqual([]);
    expect(student.legalMiddleNames).toBe("");
    expect(student.identityNumber).toBe("999");
    expect(applyCertificateReading(student, null)).toEqual([]);
  });
});

describe("schemas", () => {
  it("rejects a date of birth in the future or before 1990", () => {
    const ok = { legalFirstName: "Naledi", legalLastName: "Moeti", gender: "female", dateOfBirth: "2019-04-15", nationality: "Motswana", countryOfBirth: "Botswana", homeLanguage: "Setswana", identityType: "birth_certificate", identityNumber: "123" };
    expect(studentSchema.safeParse(ok).success).toBe(true);
    expect(studentSchema.safeParse({ ...ok, dateOfBirth: "2099-01-01" }).success).toBe(false);
    expect(studentSchema.safeParse({ ...ok, dateOfBirth: "1980-01-01" }).success).toBe(false);
    const bad = studentSchema.safeParse({ ...ok, legalFirstName: "" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(issuesToFields(bad.error).legalFirstName).toContain("first name");
  });
  it("saves countries and nationalities in the list's spelling and refuses unknown ones", () => {
    const ok = { legalFirstName: "Naledi", legalLastName: "Moeti", gender: "female", dateOfBirth: "2019-04-15", nationality: "botswana", countryOfBirth: "rsa", homeLanguage: "setswana", identityType: "birth_certificate", identityNumber: "123" };
    const parsed = studentSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.nationality).toBe("Motswana");
      expect(parsed.data.countryOfBirth).toBe("South Africa");
      expect(parsed.data.homeLanguage).toBe("Setswana");
    }
    const bad = studentSchema.safeParse({ ...ok, countryOfBirth: "Narnia", nationality: "Narnian" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const f = issuesToFields(bad.error);
      expect(f.countryOfBirth).toContain("from the list");
      expect(f.nationality).toContain("from the list");
    }
    // A language nobody listed is still accepted as typed.
    const rare = studentSchema.safeParse({ ...ok, homeLanguage: "Klingon" });
    expect(rare.success && rare.data.homeLanguage).toBe("Klingon");
  });
  it("secondary guardian is all-or-nothing", () => {
    const primary = { title: "Mr", firstName: "Kago", lastName: "Moeti", relationship: "father", gender: "M", email: "kago@example.com", mobile: "+26771234567" };
    expect(familySchema.safeParse({ primary }).success).toBe(true);
    const half = familySchema.safeParse({ primary, secondaryFirstName: "Neo" });
    expect(half.success).toBe(false);
    if (!half.success) expect(Object.keys(issuesToFields(half.error))).toContain("secondaryLastName");
    expect(familySchema.safeParse({ primary, secondaryFirstName: "Neo", secondaryLastName: "Moeti", secondaryRelationship: "mother", secondaryTitle: "Mrs", secondaryGender: "F", secondaryMobile: "+26771234568" }).success).toBe(true);
  });
  it("takes a mobile number only in the form WhatsApp accepts", () => {
    const primary = { title: "Mr", firstName: "Kago", lastName: "Moeti", relationship: "father", gender: "M", email: "kago@example.com" };
    // Without a country code we would be guessing which country it is from.
    const bare = familySchema.safeParse({ primary: { ...primary, mobile: "71234567" } });
    expect(bare.success).toBe(false);
    // A Gaborone landline is a real number and still no use for a message.
    const landline = familySchema.safeParse({ primary: { ...primary, mobile: "+2673971234" } });
    expect(landline.success).toBe(false);
    // Spaces and a trunk zero are the parent's business, not the database's.
    const spaced = familySchema.safeParse({ primary: { ...primary, mobile: "+267 71 234 567" } });
    expect(spaced.success && spaced.data.primary.mobile).toBe("+26771234567");
    // No second guardian at all is still fine.
    const noSecond = familySchema.safeParse({ primary: { ...primary, mobile: "+26771234567" } });
    expect(noSecond.success && noSecond.data.primary.phone).toBe(null);
  });
  it("asks every guardian for what the Ed-admin import will not do without", () => {
    const primary = { title: "Mr", firstName: "Kago", lastName: "Moeti", relationship: "father", gender: "M", email: "kago@example.com", mobile: "+26771234567" };
    // Gender is its own answer now. It used to be read off the title, which
    // says nothing for a Dr or a Reverend, and the row was refused on import.
    const noGender: Record<string, unknown> = { ...primary };
    delete noGender.gender;
    expect(familySchema.safeParse({ primary: noGender }).success).toBe(false);
    const asDoctor = familySchema.safeParse({ primary: { ...primary, title: "Dr", relationship: "guardian" } });
    expect(asDoctor.success && asDoctor.data.primary.gender).toBe("M");

    // A named second guardian needs a number: Ed-admin wants one on every
    // guardian it is given, and an email no longer stands in for it.
    const named = { primary, secondaryFirstName: "Neo", secondaryLastName: "Moeti", secondaryRelationship: "mother", secondaryTitle: "Mrs", secondaryGender: "F" };
    const emailOnly = familySchema.safeParse({ ...named, secondaryEmail: "neo@example.com" });
    expect(emailOnly.success).toBe(false);
    if (!emailOnly.success) expect(Object.keys(issuesToFields(emailOnly.error))).toContain("secondaryMobile");
    expect(familySchema.safeParse({ ...named, secondaryMobile: "+26771234568" }).success).toBe(true);

    // And a second guardian named without a gender is refused too.
    const noSecondGender = familySchema.safeParse({ primary, secondaryFirstName: "Neo", secondaryLastName: "Moeti", secondaryRelationship: "mother", secondaryTitle: "Mrs", secondaryMobile: "+26771234568" });
    expect(noSecondGender.success).toBe(false);
  });
  it("matches the signature loosely to the guardian's name", () => {
    expect(signatureMatches("Kago Moeti", "Kago", "Moeti")).toBe(true);
    expect(signatureMatches("  KAGO   MOETI ", "Kago", "Moeti")).toBe(true);
    expect(signatureMatches("Kago", "Kago", "Moeti")).toBe(false);
    expect(signatureMatches("", "Kago", "Moeti")).toBe(false);
  });
});

describe("prefill diff", () => {
  it("names the application facts the parent changed", () => {
    const a = { child_first_name: "Naledi", child_last_name: "Moeti", child_date_of_birth: "2019-04-15" };
    expect(changedFromApplication(a, { legalFirstName: "naledi", legalLastName: "Moeti", dateOfBirth: "2019-04-15" })).toEqual([]);
    expect(changedFromApplication(a, { legalFirstName: "Naledi Grace", legalLastName: "Moeti", dateOfBirth: "2019-04-16" })).toEqual(["child_first_name", "child_date_of_birth"]);
  });
});

describe("outstanding items after a submission", () => {
  it("names the sections not filled in, then the documents still needed", async () => {
    const { outstandingItemsText } = await import("@/lib/registration/completeness");
    const sections = { student: true, medical: false, family: true, emergency: true, documents: false, agreements: true };
    expect(outstandingItemsText({ sections, missingDocuments: [{ code: "birth_certificate", label: "Birth certificate" }] as never, rejectedDocuments: [] })).toBe(
      "the Medical section; these documents: Birth certificate"
    );
    expect(outstandingItemsText({ sections: { ...sections, medical: true, documents: true }, missingDocuments: [], rejectedDocuments: [] })).toBeNull();
  });
});
