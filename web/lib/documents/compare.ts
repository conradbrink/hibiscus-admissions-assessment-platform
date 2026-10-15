import { oneLine, oneLineOrNull } from "@/lib/documents/reading-text";
import type { Json } from "@/lib/supabase/types";

/**
 * Does what a document says agree with what the family typed? Pure and
 * tested. A comparison is a proposal for a person or the parent, never a
 * correction: "differs" opens a flag, "same" closes nothing, "unverified"
 * means one side was blank or the field is not comparable, and "unreadable"
 * means both sides gave a name that cannot be compared by machine.
 */

export type Match = "same" | "differs" | "unverified" | "unreadable";

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
    // NFKD rather than NFD: a document from China or Japan may print a name
    // in full-width letters, Ｔｈａｔｏ, which NFKD makes ordinary ones.
    .normalize("NFKD")
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

/** A value out of a reading: one line, or nothing. See reading-text.ts. */
function str(v: Json | undefined): string | null {
  return oneLineOrNull(v);
}

/**
 * Letters of another script: what is left once the Latin ones are taken
 * out, NFKD first so full-width Latin counts as Latin. Common and Inherited
 * go too: the ʿ of Saʿid and the ʻ of Kaʻiulani are letters that belong to
 * no script, and a name transliterated with them is still a Latin name.
 */
const otherScript = (s: string) => /\p{L}/u.test(s.normalize("NFKD").replace(/[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/gu, ""));
const hasLetters = (s: string) => /\p{L}/u.test(s);

/**
 * Whether two values can be compared by machine at all.
 *
 * Text is compared in the Latin alphabet, and other letters fold to
 * nothing. Two names in another script used to compare as "same", so a
 * certificate for 李娜 against a registration for 王伟 opened nothing; a
 * Latin name against a certificate in another script compared as
 * "differs" and flagged the parent's form over a translation they cannot
 * correct. A name with letters of another script anywhere in it, on either
 * side, is now "unreadable": since 15 October 2026 a person checks the
 * document by eye, and the parent is not told. That includes a name
 * printed in two scripts, where the Latin half alone could pass for
 * somebody else ("李娜 Neo" against "Neo").
 *
 * A value with no letters at all (an extractor's "—" for an empty field)
 * is "unverified": there is no name there to check.
 *
 * Null means the two can be compared.
 */
function comparability(registrationValue: string, documentValue: string): "unverified" | "unreadable" | null {
  if (!hasLetters(registrationValue) || !hasLetters(documentValue)) return "unverified";
  if (otherScript(registrationValue) || otherScript(documentValue)) return "unreadable";
  return null;
}

function nameMatch(registrationFirst: string | null, registrationMiddle: string | null, documentFirstNames: string | null): Match {
  if (!registrationFirst || !documentFirstNames) return "unverified";
  const registered = `${registrationFirst} ${registrationMiddle ?? ""}`;
  const verdict = comparability(registered, documentFirstNames);
  if (verdict) return verdict;
  const doc = tokens(documentFirstNames);
  const reg = tokens(registered);
  if (doc.join(" ") === reg.join(" ")) return "same";
  // The first name is what matters; middle names are often left off one side.
  if (doc[0] === reg[0]) return "same";
  return "differs";
}

function fullNameMatch(registrationFirst: string | null, registrationLast: string | null, documentName: string | null): Match {
  if (!registrationFirst || !registrationLast || !documentName) return "unverified";
  const verdict = comparability(`${registrationFirst} ${registrationLast}`, documentName);
  if (verdict) return verdict;
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

function surnameMatch(registration: string | null, document: string | null): Match {
  return (registration && document && comparability(registration, document)) || exactMatch(registration, document);
}

/**
 * A grade in another script is not a name, so it opens no by-eye task; it
 * is simply not compared, instead of folding to nothing and comparing as
 * "same" (五年级 against 二年级) or as "differs" against "Standard 3".
 */
function gradeMatch(registration: string | null, document: string | null): Match {
  if (registration && document && (otherScript(registration) || otherScript(document))) return "unverified";
  return exactMatch(registration, document);
}

function overlapMatch(a: string | null, b: string | null): Match {
  if (!a || !b) return "unverified";
  // Dropping the other script and comparing what is left matched "上海
  // Hospital" with "Beijing Hospital" on "hospital" alone.
  if (otherScript(a) || otherScript(b)) return "unverified";
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
    push("legal_last_name", "Surname", registration.legal_last_name, last, surnameMatch(registration.legal_last_name, last));
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
    push("current_grade", "Current grade", registration.current_grade, grade, gradeMatch(registration.current_grade, grade));
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

/**
 * What a reading means for the record: the event's summary, the tasks it
 * opens and the task types it closes. Pure, so the rules are tested without
 * a database.
 *
 * A disagreement opens a review task and, through the flags, shows on the
 * parent's form. A name that cannot be compared (see `comparability`) opens
 * a task of its own for a person to check the document by eye: it is never
 * a flag, so the parent sees nothing and is emailed nothing.
 *
 * Both kinds of task are kept per kind of document (see `mismatchTaskType`),
 * and a reading only ever closes its own kind's:
 *
 * - The mismatch task is replaced by every reading: closed, and opened again
 *   if this reading still differs. A re-read no longer adds a second one.
 * - The by-eye task is replaced by a reading that again cannot compare the
 *   name, and closed by one whose names the machine could compare (a
 *   replacement document in Latin letters). A reading that merely fails to
 *   read the name leaves it open, since nobody has looked.
 * - A document staff have already accepted or rejected opens no by-eye task:
 *   they have looked at it, and the buttons that close one are gone.
 */
export function documentReadingOutcome(input: {
  childFirstName: string;
  requirementCode: string;
  confidence: number;
  flags: MismatchFlag[];
  comparisons: Comparison[];
  documentReviewed: boolean;
}): { summary: string; tasks: ReadingTask[]; resolveTaskTypes: string[]; unreadableFields: Comparison["field"][] } {
  const label = input.requirementCode.replace(/_/g, " ");
  const names = input.comparisons.filter((c) => NAME_FIELDS.has(c.field));
  const unreadableNames = names.filter((c) => c.match === "unreadable");
  const namesSettled = names.some((c) => c.match === "same" || c.match === "differs") && !unreadableNames.length;
  const askAPerson = unreadableNames.length > 0 && !input.documentReviewed;
  const tasks: ReadingTask[] = [];
  if (input.flags.length) {
    tasks.push({
      type: mismatchTaskType(input.requirementCode),
      title: `${input.childFirstName}: ${label} differs from the registration`,
      details: `${mismatchText(input.flags)}\n\nThe reading is a proposal (confidence ${Math.round(input.confidence * 100)}%). Open the registration to compare, then ask the parent to confirm or correct the form. Nothing has been changed.`,
      priority: "normal",
    });
  }
  if (askAPerson) {
    const lines = unreadableNames.map((c) => comparisonLine(c.label, input.requirementCode, c.document_value, c.registration_value)).join("\n");
    tasks.push({
      type: unreadableTaskType(input.requirementCode),
      title: `${input.childFirstName}: check the name on the ${label} by eye`,
      details: `${lines}\n\nThese names could not be compared by machine: one of them is written in letters other than the Latin alphabet. Check the document against the registration yourself, then accept or reject it. The parent has not been told, and nothing has been changed.`,
      priority: "normal",
    });
  }
  const notCompared = unreadableNames.length ? `the name could not be compared${askAPerson ? ", and a person will check it" : ""}` : "";
  const summary = input.flags.length
    ? `Document read: ${label} differs from the registration (${input.flags.map((f) => f.label.toLowerCase()).join(", ")})${notCompared ? `; ${notCompared}` : ""}`
    : notCompared
      ? `Document read: on the ${label}, ${notCompared}`
      : `Document read: ${label} agrees with the registration`;
  return {
    summary,
    tasks,
    resolveTaskTypes: [
      mismatchTaskType(input.requirementCode),
      // Opened before mismatch tasks were kept per kind of document; closed,
      // as they always were, by a reading with no disagreement.
      ...(input.flags.length ? [] : [LEGACY_MISMATCH_TASK_TYPE]),
      ...(askAPerson || namesSettled ? [unreadableTaskType(input.requirementCode)] : []),
    ],
    unreadableFields: unreadableNames.map((c) => c.field),
  };
}

const NAME_FIELDS: ReadonlySet<Comparison["field"]> = new Set(["legal_first_name", "legal_last_name", "full_name"]);

/** The single, application-wide mismatch type used before 15 October 2026; open ones may still exist. */
export const LEGACY_MISMATCH_TASK_TYPE = "review_document_mismatch";

/**
 * One mismatch task type per kind of document, for the reason given at
 * `unreadableTaskType`: tasks are resolved by type across the application,
 * and with one type an agreeing school report closed the birth
 * certificate's task while its flag stayed on the parent's form.
 */
export function mismatchTaskType(requirementCode: string): string {
  return `${LEGACY_MISMATCH_TASK_TYPE}:${requirementCode}`;
}

type ReadingTask = { type: string; title: string; details: string; priority: "normal" };

/**
 * One by-eye task type per kind of document. Tasks are resolved by type
 * across the application, so a single type would let a reading of the school
 * report close the birth certificate's task before anybody had looked at it.
 * A family has one live document of each kind.
 */
export function unreadableTaskType(requirementCode: string): string {
  return `review_document_unreadable:${requirementCode}`;
}

export function mismatchFlags(comparisons: Comparison[], requirementCode: string, documentId: string): MismatchFlag[] {
  return comparisons
    .filter((c) => c.match === "differs")
    .map((c) => ({ field: c.field, label: c.label, registration_value: c.registration_value, document_value: c.document_value, requirement_code: requirementCode, document_id: documentId }));
}

/** The flags, worded for an email or a task: "Date of birth: the birth certificate shows 2017-04-15; the form says 2017-04-16". */
export function mismatchText(flags: MismatchFlag[]): string {
  return flags.map((f) => comparisonLine(f.label, f.requirement_code, f.document_value, f.registration_value)).join("\n");
}

function comparisonLine(label: string, requirementCode: string, documentValue: string | null, registrationValue: string | null): string {
  return `${label}: the ${requirementCode.replace(/_/g, " ")} shows ${documentValue ?? "—"}; the form says ${registrationValue ?? "—"}`;
}

/**
 * Flags back out of `registrations.mismatch_flags`, which is a `json` column
 * holding whatever an earlier version of this code put there. Both values
 * are cleaned on the way out as well as on the way in: rows written before
 * `oneLine` existed are still in the database, and they are still rendered
 * on the parent's form and mailed to them.
 */
export function parseMismatchFlags(json: Json | null | undefined): MismatchFlag[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x): x is MismatchFlag => !!x && typeof x === "object" && "field" in x && "document_id" in x)
    .map((f) => ({ ...f, label: oneLine(String(f.label ?? "")), document_value: oneLineOrNull(f.document_value), registration_value: oneLineOrNull(f.registration_value) }));
}
