import { z } from "zod";
import { canonicalCountry, canonicalNationality } from "@/lib/countries";
import { canonicalFromList, LANGUAGES, MEDICAL_AIDS } from "@/lib/pick-lists";
import { mobileNumber, optionalMobileNumber } from "@/lib/validation";

/**
 * What each registration step accepts. Shared by the server actions (the
 * only validators) and the tests. Every free-text field is capped; both
 * guardians are required, each with an email and a mobile; dates are sane.
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

/**
 * Ed-admin's Gender column, in its own values, and a required one.
 *
 * It used to be worked out from the title, which answers for Mr and Mrs and
 * for nobody else: a guardian who is Dr or Reverend, with a relationship that
 * does not settle it either, exported blank and Ed-admin refused the row. It
 * is asked for rather than inferred — from the title, and certainly not from
 * a first name.
 */
export const GUARDIAN_GENDERS = ["F", "M"] as const;
export const GUARDIAN_GENDER_LABELS: Record<(typeof GUARDIAN_GENDERS)[number], string> = { F: "Female", M: "Male" };

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
  gender: z.enum(GUARDIAN_GENDERS, { error: "Choose female or male." }),
  email: z.string().trim().max(160).optional().transform((v) => (v ? v : null)),
  // A mobile is the number the school messages, so it is checked against the
  // country it claims to be from; "other phone" is a landline nobody messages
  // and stays free text.
  mobile: optionalMobileNumber,
  phone: optional(40),
  address: optional(300),
  nationality: optionalNationality,
});

/**
 * Both guardians, and an email and a mobile for each.
 *
 * The second guardian used to be optional, and a family who left it out
 * reached Ed-admin with nothing on its G2 sheets. From 15 October 2026 every
 * registration needs a second guardian, with no exception: a parent who is
 * the only one names another adult who cares for the child, such as a
 * grandparent.
 *
 * Both are the same `guardian` rules. The second guardian used to have its
 * own hand-written copy, and the copy drifted: its nationality was never
 * checked against the list, and Ed-admin dropped the ones it did not know.
 */
const requiredGuardian = guardian.extend({
  email: z.email("Enter a valid email address.").max(160),
  // `mobileNumber` asks for "a mobile number we can reach you on", which is
  // right on the enquiry form and wrong under the second guardian's name.
  mobile: z.string().trim().min(1, "Enter a mobile number.").pipe(mobileNumber),
});

/**
 * Nothing checks that the second guardian is somebody else. Every version of
 * that check tried on 15 October 2026 refused a real family — a father and
 * the grandfather he names share a name, couples share a mobile and an
 * email — and a family refused here cannot finish registering at all. A
 * parent set on getting past it can type any name. The office sees both
 * guardians on the registration page.
 */
export const familySchema = z.object({ primary: requiredGuardian, secondary: requiredGuardian });

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
  // NFKC turns full-width letters from a CJK keyboard into ordinary ones. The
  // signature is stored as typed and printed on the signed-agreements PDF,
  // whose font has no full-width glyphs.
  signatureName: required(120, "Type your full name as your signature.").transform((v) => v.normalize("NFKC")),
  acceptedKeys: z.array(z.string().regex(/^[a-z0-9_]+$/)).default([]),
  /**
   * The agreements the parent answered *no* to. Only an agreement the school
   * marked `may_decline` can be here, and the action checks that: a refusal is
   * a complete answer for the photographs consent and no answer at all for the
   * fees policy.
   */
  declinedKeys: z.array(z.string().regex(/^[a-z0-9_]+$/)).default([]),
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

/** Latin letters NFKD cannot split, spelled as a keyboard without them would. */
const LATIN_LETTERS: Record<string, string> = { "ı": "i", "ł": "l", "ø": "o", "đ": "d", "ð": "d", "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th" };
const UMLAUTS: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue" };

/**
 * A name folded for the signature check: accents off (NFKD, which also turns
 * full-width letters from a CJK keyboard into ordinary ones), the letters
 * above spelled out, letters of every script kept, everything else gone.
 * `umlautAsE` spells ü as "ue", the way a German speaker without the key
 * types it; without it ü is plain "u".
 */
function signatureFold(value: string, umlautAsE: boolean): string {
  let s = value.toLowerCase();
  if (umlautAsE) s = s.replace(/[äöü]/g, (c) => UMLAUTS[c]);
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[ıłøđðßæœþ]/g, (c) => LATIN_LETTERS[c])
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The typed signature must be the primary guardian's name, loosely: case,
 * spacing, accents and the way a letter is typed on a keyboard without it
 * all aside.
 *
 * It used to fold everything to a-z, which drops an accented letter outright:
 * "Kágo" became "kgo" while the signature "Kago" kept its a, so the parent
 * was refused for leaving the accent out. "Yilmaz" for "Yılmaz" and "Mueller"
 * for "Müller" were refused the same way, and a signature in the name's own
 * script folded to nothing and was refused too.
 *
 * Each part of the name may now match under that old fold or under
 * `signatureFold` either way. These are alternatives, never replacements:
 * the check only accepts more than it did, because a refused signature is a
 * parent stuck at the last step of registration. That keeps one old
 * looseness on purpose — a part with no Latin letters is "included" in any
 * Latin signature, which is how "Mohammed Ali" signs for محمد علي.
 */
export function signatureMatches(signature: string, firstName: string, lastName: string): boolean {
  const folds = [
    (s: string) => s.toLowerCase().replace(/[^a-z]/g, ""),
    (s: string) => signatureFold(s, false),
    (s: string) => signatureFold(s, true),
  ];
  if (!folds.some((fold) => fold(signature).length > 0)) return false;
  return [firstName, lastName].every((part) =>
    folds.some((fold) => {
      const sig = fold(signature);
      return sig.length > 0 && sig.includes(fold(part));
    })
  );
}
