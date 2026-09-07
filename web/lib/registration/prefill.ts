import type { ApplicationGraph } from "@/lib/applications";
import type { Json, RegistrationContactRow, RegistrationRow } from "@/lib/supabase/types";

/**
 * "We already have this — is it still correct?" The application and the
 * enquiring contact fill the form before the parent sees it, and the fields
 * that came from them are named so the form can say so and the action can
 * record what changed.
 */
export type RegistrationPrefill = {
  student: Record<string, string>;
  primary: Record<string, string>;
  prefilledFields: string[];
  /** Student fields filled from the birth certificate's reading, for the form to mark "please check". */
  fromDocument: string[];
};

/** What the extractor read from the live birth certificate, when there is one. */
export type CertificateReading = { fields: Record<string, Json> };

const str = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The birth certificate fills what the family has not told us yet, and
 * only that: the names and date of birth from the enquiry stay as typed
 * (a disagreement is a flag, never a silent change), so the reading adds
 * middle names, place of birth, gender and the registration number. The
 * parent still saves the form: that is the write.
 */
export function applyCertificateReading(student: Record<string, string>, reading: CertificateReading | null): string[] {
  if (!reading) return [];
  const filled: string[] = [];
  const set = (key: string, value: string | null) => {
    if (value && !student[key]) {
      student[key] = value;
      filled.push(key);
    }
  };
  const f = reading.fields;
  const names = (str(f.first_names) ?? "").split(/\s+/).filter(Boolean);
  if (names.length) {
    set("legalFirstName", names[0]);
    const first = student.legalFirstName?.trim().toLowerCase();
    if (names.length > 1 && names[0].toLowerCase() === first) set("legalMiddleNames", names.slice(1).join(" "));
  }
  set("legalLastName", str(f.last_name));
  set("dateOfBirth", str(f.date_of_birth));
  set("placeOfBirth", str(f.place_of_birth));
  const sex = str(f.sex);
  if (sex === "female" || sex === "male") set("gender", sex);
  const number = str(f.registration_number);
  if (number && !student.identityNumber) {
    set("identityNumber", number);
    set("identityType", "birth_certificate");
  }
  return filled;
}

export function prefillRegistration(
  graph: Pick<ApplicationGraph, "application" | "contact" | "grade">,
  registration: RegistrationRow | null,
  primary: RegistrationContactRow | null,
  reading: CertificateReading | null = null
): RegistrationPrefill {
  const a = graph.application;
  const c = graph.contact;
  const prefilled: string[] = [];
  const student: Record<string, string> = {
    legalFirstName: registration?.legal_first_name ?? a.child_first_name,
    legalMiddleNames: registration?.legal_middle_names ?? "",
    legalLastName: registration?.legal_last_name ?? a.child_last_name,
    preferredName: registration?.preferred_name ?? a.child_preferred_name ?? "",
    gender: registration?.gender ?? "",
    dateOfBirth: registration?.date_of_birth ?? a.child_date_of_birth,
    nationality: registration?.nationality ?? "",
    countryOfBirth: registration?.country_of_birth ?? "",
    placeOfBirth: registration?.place_of_birth ?? "",
    homeLanguage: registration?.home_language ?? "",
    identityType: registration?.identity_type ?? "",
    identityNumber: registration?.identity_number ?? "",
    previousInstitution: registration?.previous_institution ?? a.current_school ?? "",
    currentGrade: registration?.current_grade ?? a.current_grade ?? "",
  };
  // The certificate only fills a form the parent has not yet saved.
  const fromDocument = registration?.student_completed_at ? [] : applyCertificateReading(student, reading);
  if (!registration?.student_completed_at) {
    prefilled.push("legalFirstName", "legalLastName", "dateOfBirth");
    if (a.child_preferred_name) prefilled.push("preferredName");
    if (a.current_school) prefilled.push("previousInstitution");
    if (a.current_grade) prefilled.push("currentGrade");
  }
  const primaryValues: Record<string, string> = {
    firstName: primary?.first_name ?? c.first_name,
    lastName: primary?.last_name ?? c.last_name,
    relationship: primary?.relationship ?? "",
    email: primary?.email ?? c.email,
    mobile: primary?.mobile ?? c.mobile ?? "",
    phone: primary?.phone ?? "",
    address: primary?.address ?? "",
    nationality: primary?.nationality ?? "",
  };
  if (!primary) {
    prefilled.push("primary.firstName", "primary.lastName", "primary.email");
    if (c.mobile) prefilled.push("primary.mobile");
  }
  return { student, primary: primaryValues, prefilledFields: prefilled, fromDocument };
}

/** Which of the application's own facts the parent changed: the review task lists them. */
export function changedFromApplication(
  a: Pick<ApplicationGraph["application"], "child_first_name" | "child_last_name" | "child_date_of_birth">,
  submitted: { legalFirstName: string; legalLastName: string; dateOfBirth: string }
): string[] {
  const changed: string[] = [];
  const same = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  if (!same(a.child_first_name, submitted.legalFirstName)) changed.push("child_first_name");
  if (!same(a.child_last_name, submitted.legalLastName)) changed.push("child_last_name");
  if (a.child_date_of_birth !== submitted.dateOfBirth) changed.push("child_date_of_birth");
  return changed;
}
