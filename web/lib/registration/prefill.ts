import type { ApplicationGraph } from "@/lib/applications";
import type { RegistrationContactRow, RegistrationRow } from "@/lib/supabase/types";

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
};

export function prefillRegistration(
  graph: Pick<ApplicationGraph, "application" | "contact" | "grade">,
  registration: RegistrationRow | null,
  primary: RegistrationContactRow | null
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
  return { student, primary: primaryValues, prefilledFields: prefilled };
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
