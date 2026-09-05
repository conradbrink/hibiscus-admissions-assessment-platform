import { z } from "zod";

/**
 * What the extractor may read from each kind of document, and how it is
 * asked. Pure and tested. Medical documents are not here on purpose: they
 * are never sent to a model.
 *
 * Every field is nullable — "not printed" or "unreadable" is a null, never
 * a guess — and the whole reading carries one confidence.
 */

const text = z.string().max(200).nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const confidence = z.number().min(0).max(1);

export const BIRTH_CERTIFICATE_SCHEMA = z.object({
  first_names: text,
  last_name: text,
  date_of_birth: isoDate,
  place_of_birth: text,
  sex: z.enum(["female", "male"]).nullable(),
  registration_number: text,
  confidence,
});

export const SCHOOL_REPORT_SCHEMA = z.object({
  institution_name: text,
  student_name: text,
  grade_or_year: text,
  academic_year: text,
  confidence,
});

export const VACCINATION_CARD_SCHEMA = z.object({
  child_name: text,
  last_entry_date: isoDate,
  confidence,
});

export type BirthCertificateFields = z.infer<typeof BIRTH_CERTIFICATE_SCHEMA>;
export type SchoolReportFields = z.infer<typeof SCHOOL_REPORT_SCHEMA>;
export type VaccinationCardFields = z.infer<typeof VACCINATION_CARD_SCHEMA>;

export type ExtractableCode = "birth_certificate" | "school_report" | "transfer_certificate" | "vaccination_card";

export const EXTRACTABLE_CODES: ReadonlySet<string> = new Set<ExtractableCode>([
  "birth_certificate",
  "school_report",
  "transfer_certificate",
  "vaccination_card",
]);

export function isExtractable(code: string): code is ExtractableCode {
  return EXTRACTABLE_CODES.has(code);
}

export function schemaFor(code: ExtractableCode) {
  switch (code) {
    case "birth_certificate":
      return BIRTH_CERTIFICATE_SCHEMA;
    case "school_report":
    case "transfer_certificate":
      return SCHOOL_REPORT_SCHEMA;
    case "vaccination_card":
      return VACCINATION_CARD_SCHEMA;
  }
}

export const EXTRACTION_PROMPT_VERSION = "document-extraction-v1";

/** Short and strict: transcribe what is printed, never infer. */
export function systemPromptFor(code: ExtractableCode): string {
  const what =
    code === "birth_certificate"
      ? "a birth certificate"
      : code === "vaccination_card"
        ? "a child's vaccination card"
        : "a school report or transfer certificate";
  return [
    `You transcribe fields from ${what} supplied as an image or PDF, into the given JSON shape.`,
    "Rules that are not negotiable:",
    "- Copy only what is printed. Never infer, guess, complete, correct or normalise a value beyond the format asked for.",
    "- A field that is not printed, is illegible, or is ambiguous is null.",
    "- Dates are ISO (YYYY-MM-DD). If the printed date is ambiguous between day-first and month-first, return null.",
    "- Names are copied as printed, in the printed order.",
    "- confidence is your overall confidence, 0 to 1, that every non-null field is exactly what is printed.",
    "- Do not describe, assess or comment on the person or the document; return only the fields.",
  ].join("\n");
}

export function userPromptFor(code: ExtractableCode): string {
  switch (code) {
    case "birth_certificate":
      return "Read the attached birth certificate and return the child's first names, surname, date of birth, place of birth, sex and the certificate's registration or entry number.";
    case "vaccination_card":
      return "Read the attached vaccination card and return the child's name as printed and the date of the most recent entry.";
    default:
      return "Read the attached school report or transfer certificate and return the institution's name, the student's name as printed, the grade or year, and the academic year.";
  }
}

/** What the development AI adapter returns, so the pipeline runs with no key. Marked so nobody mistakes it for a reading. */
export function devOutputFor(code: ExtractableCode): Record<string, unknown> {
  switch (code) {
    case "birth_certificate":
      return { first_names: "Dev Sample", last_name: "Reading", date_of_birth: "2017-04-15", place_of_birth: "Gaborone", sex: null, registration_number: "DEV-0001", confidence: 0.5 };
    case "vaccination_card":
      return { child_name: "Dev Sample Reading", last_entry_date: "2022-01-10", confidence: 0.5 };
    default:
      return { institution_name: "Dev Sample Primary School", student_name: "Dev Sample Reading", grade_or_year: "Standard 3", academic_year: "2025", confidence: 0.5 };
  }
}
