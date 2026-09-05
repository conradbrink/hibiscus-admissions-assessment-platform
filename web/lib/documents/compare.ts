import type { Json } from "@/lib/supabase/types";

/**
 * Does what a document says agree with what the family typed? Pure and
 * tested. A comparison is a proposal for a person or the parent, never a
 * correction: "differs" opens a flag, "same" closes nothing, "unverified"
 * means one side was blank or the field is not comparable.
 */

export type Match = "same" | "differs" | "unverified";

export type Comparison = {
  /** The registration field the document speaks to. */
  field: "legal_first_name" | "legal_last_name" | "date_of_birth" | "place_of_birth" | "gender" | "previous_institution" | "current_grade" | "full_name";
  label: string;
  registration_value: string | null;
  document_value: string | null;
  match: Match;
};

/** The registration as it stands, with the application's own facts as the fallback for what the parent has not typed yet. */
export type RegistrationFacts = {
  legal_first_name: string | null;
  legal_middle_names: string | null;
  legal_last_name: string | null;
  date_of_birth: string | null;
  place_of_birth: string | null;
  gender: string | null;
  previous_institution: string | null;
  current_grade: string | null;
};

export function normaliseText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["the", "school", "primary", "secondary", "junior", "senior", "of", "and", "college", "academy", "international", "pre"]);

function tokens(s: string | null | undefined, dropStopwords = false): string[] {
  return normaliseText(s)
    .split(" ")
    .filter((t) => t.length > 0 && (!dropStopwords || !STOPWORDS.has(t)));
}

function str(v: Json | undefined): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function nameMatch(registrationFirst: string | null, registrationMiddle: string | null, documentFirstNames: string | null): Match {
  if (!registrationFirst || !documentFirstNames) return "unverified";
  const doc = tokens(documentFirstNames);
  const reg = tokens(`${registrationFirst} ${registrationMiddle ?? ""}`);
  if (doc.join(" ") === reg.join(" ")) return "same";
  // The first name is what matters; middle names are often left off one side.
  if (doc[0] === reg[0]) return "same";
  return "differs";
}

function fullNameMatch(registrationFirst: string | null, registrationLast: string | null, documentName: string | null): Match {
  if (!registrationFirst || !registrationLast || !documentName) return "unverified";
  const doc = new Set(tokens(documentName));
  const first = tokens(registrationFirst)[0];
  const last = tokens(registrationLast);
  if (first && doc.has(first) && last.every((t) => doc.has(t))) return "same";
  return "differs";
}

function exactMatch(a: string | null, b: string | null): Match {
  if (!a || !b) return "unverified";
  return normaliseText(a) === normaliseText(b) ? "same" : "differs";
}

function overlapMatch(a: string | null, b: string | null): Match {
  if (!a || !b) return "unverified";
  const ta = tokens(a, true);
  const tb = new Set(tokens(b, true));
  if (!ta.length || !tb.size) return "unverified";
  const shared = ta.filter((t) => tb.has(t)).length;
  return shared >= Math.ceil(Math.min(ta.length, tb.size) / 2) ? "same" : "differs";
}

function genderMatch(registration: string | null, documentSex: string | null): Match {
  if (!registration || !documentSex) return "unverified";
  if (registration !== "female" && registration !== "male") return "unverified";
  return registration === documentSex ? "same" : "differs";
}

/** Compares one document's reading with the registration. */
export function compareExtraction(registration: RegistrationFacts, fields: Record<string, Json>, requirementCode: string): Comparison[] {
  const out: Comparison[] = [];
  const push = (field: Comparison["field"], label: string, registrationValue: string | null, documentValue: string | null, match: Match) =>
    out.push({ field, label, registration_value: registrationValue, document_value: documentValue, match });

  if (requirementCode === "birth_certificate") {
    const first = str(fields.first_names);
    push("legal_first_name", "First names", [registration.legal_first_name, registration.legal_middle_names].filter(Boolean).join(" ") || null, first, nameMatch(registration.legal_first_name, registration.legal_middle_names, first));
    const last = str(fields.last_name);
    push("legal_last_name", "Surname", registration.legal_last_name, last, exactMatch(registration.legal_last_name, last));
    const dob = str(fields.date_of_birth);
    push("date_of_birth", "Date of birth", registration.date_of_birth, dob, exactMatch(registration.date_of_birth, dob));
    const place = str(fields.place_of_birth);
    push("place_of_birth", "Place of birth", registration.place_of_birth, place, overlapMatch(registration.place_of_birth, place));
    const sex = str(fields.sex);
    push("gender", "Gender", registration.gender, sex, genderMatch(registration.gender, sex));
    return out;
  }
  if (requirementCode === "school_report" || requirementCode === "transfer_certificate") {
    const inst = str(fields.institution_name);
    push("previous_institution", "Previous school", registration.previous_institution, inst, overlapMatch(registration.previous_institution, inst));
    const name = str(fields.student_name);
    push("full_name", "Student's name", [registration.legal_first_name, registration.legal_last_name].filter(Boolean).join(" ") || null, name, fullNameMatch(registration.legal_first_name, registration.legal_last_name, name));
    const grade = str(fields.grade_or_year);
    push("current_grade", "Current grade", registration.current_grade, grade, exactMatch(registration.current_grade, grade));
    return out;
  }
  if (requirementCode === "vaccination_card") {
    const name = str(fields.child_name);
    push("full_name", "Child's name", [registration.legal_first_name, registration.legal_last_name].filter(Boolean).join(" ") || null, name, fullNameMatch(registration.legal_first_name, registration.legal_last_name, name));
  }
  return out;
}

/** What goes on the registration for the parent's form: only the disagreements. */
export type MismatchFlag = {
  field: Comparison["field"];
  label: string;
  registration_value: string | null;
  document_value: string | null;
  requirement_code: string;
  document_id: string;
};

export function mismatchFlags(comparisons: Comparison[], requirementCode: string, documentId: string): MismatchFlag[] {
  return comparisons
    .filter((c) => c.match === "differs")
    .map((c) => ({ field: c.field, label: c.label, registration_value: c.registration_value, document_value: c.document_value, requirement_code: requirementCode, document_id: documentId }));
}

/** The flags, worded for an email or a task: "Date of birth: the birth certificate shows 2017-04-15; the form says 2017-04-16". */
export function mismatchText(flags: MismatchFlag[]): string {
  return flags
    .map((f) => `${f.label}: the ${f.requirement_code.replace(/_/g, " ")} shows ${f.document_value ?? "—"}; the form says ${f.registration_value ?? "—"}`)
    .join("\n");
}

export function parseMismatchFlags(json: Json | null | undefined): MismatchFlag[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is MismatchFlag => !!x && typeof x === "object" && "field" in x && "document_id" in x);
}
