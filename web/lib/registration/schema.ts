import { z } from "zod";

/**
 * What each registration step accepts. Shared by the server actions (the
 * only validators) and the tests. Every free-text field is capped; the
 * secondary guardian is all-or-nothing; dates are sane.
 */

const text = (max: number) => z.string().trim().max(max);
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const optional = (max: number) => text(max).optional().transform((v) => (v ? v : null));

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
export const IDENTITY_TYPES = ["omang", "passport", "birth_certificate", "other"] as const;
export const RELATIONSHIPS = ["mother", "father", "parent", "guardian", "grandparent", "other"] as const;

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

export const studentSchema = z.object({
  legalFirstName: required(80, "Enter the child's first name as it appears on the birth certificate."),
  legalMiddleNames: optional(120),
  legalLastName: required(80, "Enter the child's surname."),
  preferredName: optional(80),
  gender: z.enum(GENDERS, { error: "Choose one." }),
  dateOfBirth,
  nationality: required(80, "Enter the child's nationality."),
  countryOfBirth: required(80, "Enter the country of birth."),
  placeOfBirth: optional(120),
  homeLanguage: required(60, "Enter the language spoken at home."),
  identityType: z.enum(IDENTITY_TYPES, { error: "Choose the identity document." }),
  identityNumber: required(40, "Enter the identity or registration number."),
  previousInstitution: optional(160),
  currentGrade: optional(60),
});

export const medicalSchema = z.object({
  medicalAidName: optional(120),
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
  firstName: required(80, "Enter a first name."),
  lastName: required(80, "Enter a surname."),
  relationship: z.enum(RELATIONSHIPS, { error: "Choose the relationship." }),
  email: z.string().trim().max(160).optional().transform((v) => (v ? v : null)),
  mobile: optional(40),
  phone: optional(40),
  address: optional(300),
  nationality: optional(80),
});

const emptyGuardian = (g: Record<string, unknown>) => Object.values(g).every((v) => v === null || v === undefined || v === "");

export const familySchema = z
  .object({
    primary: guardian.extend({ email: z.email("Enter a valid email address.").max(160), mobile: required(40, "Enter a mobile number.") }),
    secondaryFirstName: optional(80),
    secondaryLastName: optional(80),
    secondaryRelationship: z.enum(RELATIONSHIPS).optional(),
    secondaryEmail: optional(160),
    secondaryMobile: optional(40),
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
