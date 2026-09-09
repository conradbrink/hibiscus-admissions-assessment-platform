import { describe, expect, it } from "vitest";
import { applicableRequirements, missingDocumentsText, nextStep, registrationCompleteness } from "@/lib/registration/completeness";
import { changedFromApplication } from "@/lib/registration/prefill";
import { familySchema, issuesToFields, signatureMatches, studentSchema } from "@/lib/registration/schema";
import type { AgreementTemplateRow, DocumentRequirementRow, DocumentRow, RegistrationContactRow, RegistrationRow } from "@/lib/supabase/types";

const req = (code: string, required = true, min: number | null = null): DocumentRequirementRow => ({
  code, label: code, description: null, required, grade_sort_min: min, grade_sort_max: null, sort_order: 0, is_active: true, created_at: "", updated_at: "",
});
const doc = (code: string, review: DocumentRow["review_status"] = "pending"): DocumentRow => ({
  id: code, application_id: "a", requirement_code: code, storage_bucket: "b", storage_path: `p/${code}`, original_filename: "f", mime_type: "application/pdf",
  size_bytes: 1, sha256: "x", uploaded_by: "parent", uploaded_by_staff_id: null, scan_status: "not_scanned", scanner: "none", review_status: review,
  reviewed_by: null, reviewed_at: null, review_note: null, extraction_status: "not_run", extracted_fields: null, extraction_model: null, extraction_error: null, extracted_at: null, superseded_by: null, deleted_at: null,
  uploaded_at: "", created_at: "", updated_at: "",
});
const template = (id: string, required = true): AgreementTemplateRow => ({ id, key: id, version: 1, name: id, description: null, body_html: "", required, document_url: null, sort_order: 100, is_active: true, created_by: null, created_at: "", updated_at: "" });
const contact = (kind: RegistrationContactRow["kind"]): RegistrationContactRow => ({
  id: kind, application_id: "a", kind, position: 1, contact_id: null, first_name: "K", last_name: "M", relationship: "mother", email: null, mobile: null, mobile_normalised: null, phone: null, address: null, nationality: null, created_at: "", updated_at: "",
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

describe("completeness", () => {
  const base = { registration: stamped(), contacts: [contact("primary_guardian"), contact("emergency")], requirements, gradeSort: 60, agreementTemplates: [template("policies")], acceptances: [{ id: "x", application_id: "a", agreement_template_id: "policies", template_key: "policies", template_version: 1, body_hash: "h", signature_name: "K M", signature_svg: null, ip_hash: null, user_agent: null, accepted_at: "" }] };

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
    const primary = { firstName: "Kago", lastName: "Moeti", relationship: "father", email: "kago@example.com", mobile: "+26771234567" };
    expect(familySchema.safeParse({ primary }).success).toBe(true);
    const half = familySchema.safeParse({ primary, secondaryFirstName: "Neo" });
    expect(half.success).toBe(false);
    if (!half.success) expect(Object.keys(issuesToFields(half.error))).toContain("secondaryLastName");
    expect(familySchema.safeParse({ primary, secondaryFirstName: "Neo", secondaryLastName: "Moeti", secondaryRelationship: "mother", secondaryMobile: "+26771234568" }).success).toBe(true);
  });
  it("takes a mobile number only in the form WhatsApp accepts", () => {
    const primary = { firstName: "Kago", lastName: "Moeti", relationship: "father", email: "kago@example.com" };
    // Without a country code we would be guessing which country it is from.
    const bare = familySchema.safeParse({ primary: { ...primary, mobile: "71234567" } });
    expect(bare.success).toBe(false);
    // A Gaborone landline is a real number and still no use for a message.
    const landline = familySchema.safeParse({ primary: { ...primary, mobile: "+2673971234" } });
    expect(landline.success).toBe(false);
    // Spaces and a trunk zero are the parent's business, not the database's.
    const spaced = familySchema.safeParse({ primary: { ...primary, mobile: "+267 71 234 567" } });
    expect(spaced.success && spaced.data.primary.mobile).toBe("+26771234567");
    // A second guardian may have no number at all.
    const noSecond = familySchema.safeParse({ primary: { ...primary, mobile: "+26771234567" } });
    expect(noSecond.success && noSecond.data.primary.phone).toBe(null);
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
