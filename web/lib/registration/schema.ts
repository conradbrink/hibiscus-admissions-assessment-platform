import { z } from "zod";
import { canonicalCountry, canonicalNationality } from "@/lib/countries";
import { canonicalFromList, LANGUAGES, MEDICAL_AIDS } from "@/lib/pick-lists";
import { mobileNumber, optionalMobileNumber } from "@/lib/validation";

/**
 * What each registration step accepts. Shared by the server actions (the
 * only validators) and the tests. Every free-text field is capped; the
 * secondary guardian is all-or-nothing; dates are sane.
 */

const text = (max: number) => z.string().trim().max(max);
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const optional = (max: number) => text(max).optional().transform((v) => (v ? v : null));

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
/** The "current grade" answer for a child who has not started school. */
export const NOT_AT_SCHOOL = "Not at school yet";
export const IDENTITY_TYPES = ["omang", "passport", "birth_certificate", "other"] as const;
export const RELATIONSHIPS = ["mother", "father", "parent", "guardian", "grandparent", "other"] as const;

/**
 * How a guardian is addressed. Ed-admin requires a title on every guardian
 * and its Relation list is gendered throughout — `Guardian (female)`,
 * `Grandmother`, with no neutral form — so the title is also what tells us
 * which one to send without guessing a person's sex from their first name.
 *
 * These are Ed-admin's own spellings, taken from its Title dropdown. The
 * short list is the one a family actually uses; the rest of theirs (Bishop,
 * Judge, Nkosi, Advocate) are reachable as "Other" rather than making every
 * parent scroll past them.
 */
export const TITLES = ["Mr", "Mrs", "Miss", "Ms", "Dr", "Professor", "Reverend", "Pastor", "Other"] as const;

export const RELATIONSHIP_LABELS: Record<(typeof RELATIONSHIPS)[number], string> = {
  mother: "Mother",
  father: "Father",
  parent: "Parent",
  guardian: "Guardian",
  grandparent: "Grandparent",
  other: "Other",
};

const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth as YYYY-MM-DD.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1990 && d.getTime() < Date.now();
  }, "That date of birth does not look right.");

/** A country from the list, in the list's own spelling; the parent picks it from a search box. */
const countryField = (message: string) =>
  z.string().trim().max(80).transform((v, ctx) => {
    const c = canonicalCountry(v);
    if (!c) ctx.addIssue({ code: "custom", message });
    return c ?? v;
  });
const nationalityField = (message: string) =>
  z.string().trim().max(80).transform((v, ctx) => {
    const n = canonicalNationality(v);
    if (!n) ctx.addIssue({ code: "custom", message });
    return n ?? v;
  });
const optionalNationality = z.string().trim().max(80).optional().transform((v, ctx) => {
  if (!v) return null;
  const n = canonicalNationality(v);
  if (!n) ctx.addIssue({ code: "custom", message: "Choose a nationality from the list, or leave it blank." });
  return n ?? v;
});

export const studentSchema = z.object({
  legalFirstName: required(80, "Enter the child's first name as it appears on the birth certificate."),
  legalMiddleNames: optional(120),
  legalLastName: required(80, "Enter the child's surname."),
  preferredName: optional(80),
  gender: z.enum(GENDERS, { error: "Choose one." }),
  dateOfBirth,
  nationality: nationalityField("Choose the child's nationality from the list."),
  countryOfBirth: countryField("Choose the country of birth from the list."),
  placeOfBirth: optional(120),
  homeLanguage: required(60, "Choose or enter the language spoken at home.").transform((v) => canonicalFromList(LANGUAGES, v) ?? v),
  identityType: z.enum(IDENTITY_TYPES, { error: "Choose the identity document." }),
  identityNumber: required(40, "Enter the identity or registration number."),
  previousInstitution: optional(160),
  currentGrade: optional(60),
});

export const medicalSchema = z.object({
  medicalAidName: text(120).optional().transform((v) => canonicalFromList(MEDICAL_AIDS, v)),
  medicalAidNumber: optional(60),
  medicalAidPrincipalMember: optional(120),
  emergencyTreatmentConsent: z.enum(["yes", "no"], { error: "Tell us whether the school may authorise emergency treatment." }),
  allergies: optional(1000),
  medicalConditions: optional(1000),
  medication: optional(1000),
  medicalNotes: optional(2000),
  vaccinationNotes: optional(1000),
});

const guardian = z.object({
  title: z.enum(TITLES, { error: "Choose a title." }),
  firstName: required(80, "Enter a first name."),
  lastName: required(80, "Enter a surname."),
  relationship: z.enum(RELATIONSHIPS, { error: "Choose the relationship." }),
  email: z.string().trim().max(160).optional().transform((v) => (v ? v : null)),
  // A mobile is the number the school messages, so it is checked against the
  // country it claims to be from; "other phone" is a landline nobody messages
  // and stays free text.
  mobile: optionalMobileNumber,
  phone: optional(40),
  address: optional(300),
  nationality: optionalNationality,
});

const emptyGuardian = (g: Record<string, unknown>) => Object.values(g).every((v) => v === null || v === undefined || v === "");

export const familySchema = z
  .object({
    primary: guardian.extend({ email: z.email("Enter a valid email address.").max(160), mobile: mobileNumber }),
    secondaryTitle: z.enum(TITLES).optional(),
    secondaryFirstName: optional(80),
    secondaryLastName: optional(80),
    secondaryRelationship: z.enum(RELATIONSHIPS).optional(),
    secondaryEmail: optional(160),
    secondaryMobile: optionalMobileNumber,
    secondaryPhone: optional(40),
    secondaryAddress: optional(300),
    secondaryNationality: optional(80),
  })
  .superRefine((v, ctx) => {
    const partial = { f: v.secondaryFirstName, l: v.secondaryLastName, e: v.secondaryEmail, m: v.secondaryMobile, p: v.secondaryPhone, a: v.secondaryAddress, n: v.secondaryNationality };
    if (emptyGuardian(partial) && !v.secondaryRelationship) return;
    if (!v.secondaryFirstName) ctx.addIssue({ code: "custom", path: ["secondaryFirstName"], message: "Enter the second guardian's first name, or leave the whole section blank." });
    if (!v.secondaryLastName) ctx.addIssue({ code: "custom", path: ["secondaryLastName"], message: "Enter the second guardian's surname." });
    if (!v.secondaryRelationship) ctx.addIssue({ code: "custom", path: ["secondaryRelationship"], message: "Choose the relationship." });
    if (!v.secondaryTitle) ctx.addIssue({ code: "custom", path: ["secondaryTitle"], message: "Choose a title." });
    if (!v.secondaryMobile && !v.secondaryEmail) ctx.addIssue({ code: "custom", path: ["secondaryMobile"], message: "Enter a mobile number or an email address." });
  });

export const emergencySchema = z.object({
  contacts: z
    .array(
      z.object({
        firstName: required(80, "Enter a first name."),
        lastName: required(80, "Enter a surname."),
        relationship: z.enum(RELATIONSHIPS, { error: "Choose the relationship." }),
        phone: required(40, "Enter a phone number we can reach in an emergency."),
        email: optional(160),
        address: optional(300),
      })
    )
    .min(1, "Give at least one emergency contact.")
    .max(2),
});

export const agreementsSchema = z.object({
  signatureName: required(120, "Type your full name as your signature."),
  acceptedKeys: z.array(z.string().regex(/^[a-z0-9_]+$/)).default([]),
});

/** Zod issues → { field: message }, first message per field, matching lib/validation. */
export function issuesToFields(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** The typed signature must be the primary guardian's name, loosely: case and spacing aside. */
export function signatureMatches(signature: string, firstName: string, lastName: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const sig = norm(signature);
  return sig.length > 0 && sig.includes(norm(firstName)) && sig.includes(norm(lastName));
}
