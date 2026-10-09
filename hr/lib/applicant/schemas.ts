import { z } from "zod";

/**
 * What each section of the application form accepts. Shared by the server
 * actions (the authority) and the form (for inline hints). Messages are what
 * the applicant reads: plain English, one idea each.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a full date.");
const optionalIsoDate = isoDate.optional().or(z.literal("")).transform((v) => (v ? v : null));
const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);
const optionalText = (max: number) => text(max).optional().transform((v) => (v ? v : null));

export const StartSchema = z.object({
  first_name: text(100).min(1, "Enter your first name."),
  last_name: text(100).min(1, "Enter your last name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  consent: z.literal("on", { message: "Please agree to the privacy notice to continue." }),
  talent_pool: z.literal("on").optional(),
});

export const PersonalSchema = z.object({
  first_name: text(100).min(1, "Enter your first name."),
  last_name: text(100).min(1, "Enter your last name."),
  phone: text(30).min(6, "Enter a phone number we can call."),
  nationality: text(80).min(2, "Enter your nationality."),
  is_citizen: z.enum(["yes", "no"], { message: "Tell us whether you are a citizen of the country of this post." }),
});

export const QualificationSchema = z.object({
  level: z.enum(["certificate", "diploma", "degree", "honours", "postgraduate_certificate", "masters", "doctorate", "other"]),
  title: text(200).min(2, "Enter the name of the qualification."),
  institution: text(200).min(2, "Enter where you studied."),
  year_completed: z.coerce.number().int().min(1950, "Enter the year you finished.").max(2100),
  country: optionalText(80),
  is_teaching: z.boolean(),
});

export const QualificationsSchema = z
  .array(QualificationSchema)
  .min(1, "Add at least one qualification.")
  .max(12, "Add your 12 most relevant qualifications.");

export const EmploymentSchema = z
  .object({
    employer: text(200).min(2, "Enter the employer."),
    role_title: text(200).min(2, "Enter your job title."),
    is_school: z.boolean(),
    phase_taught: optionalText(120),
    start_on: isoDate,
    end_on: optionalIsoDate,
    reason_for_leaving: optionalText(500),
  })
  .refine((j) => !j.end_on || j.end_on >= j.start_on, { message: "The end date is before the start date.", path: ["end_on"] });

export const EmploymentListSchema = z.array(EmploymentSchema).max(15, "Add your 15 most recent jobs.");

export const ComplianceSchema = z
  .object({
    registration_body: z.enum(["SACE", "BTPC", "other", "none"]),
    registration_number: optionalText(60),
    registration_expires_on: optionalIsoDate,
    needs_permit: z.enum(["yes", "no"]),
    permit_type: optionalText(80),
    permit_number: optionalText(60),
    permit_expires_on: optionalIsoDate,
    police_clearance: z.enum(["have", "applied", "none"]),
    police_clearance_issued_on: optionalIsoDate,
    child_protection_clear: z.enum(["yes", "no"]),
    criminal_record: z.enum(["yes", "no"]),
    criminal_record_detail: optionalText(2000),
    dismissed_before: z.enum(["yes", "no"]),
    dismissed_detail: optionalText(2000),
    safeguarding_concern: z.enum(["yes", "no"]),
    safeguarding_detail: optionalText(2000),
    declaration_name: text(200).min(2, "Type your full name to sign the declaration."),
  })
  .refine((c) => c.registration_body === "none" || !!c.registration_number, {
    message: "Enter your registration number.",
    path: ["registration_number"],
  })
  .refine((c) => c.needs_permit === "no" || !!c.permit_type, { message: "Tell us the type of permit.", path: ["permit_type"] })
  .refine((c) => c.police_clearance !== "have" || !!c.police_clearance_issued_on, {
    message: "Enter the date on your police clearance.",
    path: ["police_clearance_issued_on"],
  })
  .refine((c) => c.criminal_record === "no" || !!c.criminal_record_detail, { message: "Please give details.", path: ["criminal_record_detail"] })
  .refine((c) => c.dismissed_before === "no" || !!c.dismissed_detail, { message: "Please give details.", path: ["dismissed_detail"] })
  .refine((c) => c.safeguarding_concern === "no" || !!c.safeguarding_detail, { message: "Please give details.", path: ["safeguarding_detail"] });

export const AnswerSchema = z.object({
  question_id: z.string().uuid(),
  text: z.string().max(8000, "This answer is too long."),
  // The writing behaviour the answer box recorded. Untrusted; cleaned before use.
  behaviour: z.record(z.string(), z.unknown()).optional(),
});

export const RefereeSchema = z.object({
  full_name: text(200).min(2, "Enter the referee's name."),
  relationship: z.enum(["principal", "line_manager", "colleague", "other"]),
  organisation: text(200).min(2, "Enter where they work."),
  role_title: optionalText(200),
  email: z.string().trim().toLowerCase().email("Enter the referee's email address.").max(200),
  phone: optionalText(30),
  is_most_recent_employer: z.boolean(),
});

export const SECTIONS = ["personal", "qualifications", "career", "compliance", "documents", "questions", "references"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_TITLES: Record<Section, string> = {
  personal: "About you",
  qualifications: "Qualifications",
  career: "Career history",
  compliance: "Permission to teach",
  documents: "Documents",
  questions: "Questions",
  references: "References",
};

export const SECTION_HINTS: Record<Section, string> = {
  personal: "Your name and how we can reach you.",
  qualifications: "Your degrees, diplomas and teaching qualifications.",
  career: "Where you have worked, and for how long.",
  compliance: "Your teacher registration, work permit and police clearance.",
  documents: "Your CV and copies of your certificates.",
  questions: "A few written questions about your teaching.",
  references: "Two or three people who can tell us about your work.",
};
