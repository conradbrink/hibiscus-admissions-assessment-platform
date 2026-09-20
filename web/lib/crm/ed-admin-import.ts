import { normaliseEmail, normaliseMobile, tidyName } from "@/lib/contacts";
import { ED_ADMIN } from "@/lib/enrolment/ed-admin";
import type { GuardianRelationship } from "@/lib/supabase/types";

/**
 * Reading the school's other system's records back in.
 *
 * Ed-admin hands out two things: a **students** sheet (one row per child,
 * shaped like `Admissions_Student.xlsx`: Family Code, Admission Number,
 * Grade, names, Gender, Date of Birth, … Date of Entry, Status) and a
 * **parents** workbook (Basic, G1 Contact, G1 Address, G2 Contact, G2
 * Address, Accounts — narrow sheets, every one keyed on the family code).
 * `lib/enrolment/ed-admin.ts` writes those shapes; this reads them, so a
 * file that went out comes back in, and so does the register the school
 * kept there before this system existed.
 *
 * What comes from their side and is honoured here:
 *
 *  - **The family code joins everything.** Parents and students are separate
 *    files with nothing in common but the code, and it is also the code the
 *    school bills by, so a family created from here keeps it as its own.
 *  - **Their headers, with their inconsistencies.** `Family/Sponsor Code*`,
 *    `Family/SponsorCode*`, `G2LName`: every header is reduced to its
 *    letters and digits before it is matched, so a space, a slash, a dot or
 *    an asterisk makes no difference, and the compact G2 names are aliases.
 *  - **Their grade names carry the campus.** `Stage5-HPS` is Stage 5 at one
 *    campus; the mapping lives in `campus_grades.external_grade_code`, so a
 *    student row needs no campus column and an unmapped grade is refused
 *    rather than guessed.
 *  - **Their dates are day/month/year**, as the export writes them; a cell a
 *    spreadsheet turned into a day count arrives here already as a date.
 *
 * Pure and tested; the lookups and the writes are in
 * `ed-admin-import-server.ts`.
 */

export type Table = { name: string; headers: readonly string[]; rows: readonly (readonly string[])[] };

/** "Family/Sponsor Code*" → "familysponsorcode": letters and digits only, lower case. */
export function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function keysOf(table: Table): string[] {
  return table.headers.map(headerKey);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function isoIfReal(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * A date as Ed-admin writes it, as YYYY-MM-DD. Day/month/year first, since
 * that is their order (and the export's), year-first when the year is the
 * first thing, a spelled-out month either way, and a bare day count from a
 * spreadsheet that formatted the cell as a number.
 */
export function parseEdAdminDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/.exec(s);
  if (m) {
    const yy = Number(m[3]);
    return isoIfReal(yy <= 30 ? 2000 + yy : 1900 + yy, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[\s/.-]+([a-z]{3,})[\s/.,-]+(\d{4})$/i.exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo ? isoIfReal(Number(m[3]), mo, Number(m[1])) : null;
  }
  m = /^([a-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo ? isoIfReal(Number(m[3]), mo, Number(m[2])) : null;
  }
  if (/^\d{5}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86_400_000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/** The student sheet's columns, by their key. Anything else is ignored and reported. */
export const STUDENT_KEYS = [
  "familycode", "admissionnumber", "grade", "class", "lastname", "firstname", "middlename", "othernames",
  "gender", "dateofbirth", "placeofbirth", "nationality", "bornin", "religion", "idnumber", "email", "cell",
  "studenttype", "keyword", "langprevschool", "language", "langlevel", "language2", "lang2level",
  "language3", "lang3level", "language4", "lang4level", "prevschool", "dateofapplication", "dateofentry",
  "sponsor", "status",
] as const;

export type StudentKey = (typeof STUDENT_KEYS)[number];

const STUDENT_ALIASES: Record<string, StudentKey> = {
  familysponsorcode: "familycode",
  familyspnsorcode: "familycode",
  family: "familycode",
  admissionno: "admissionnumber",
  admissionnr: "admissionnumber",
  admission: "admissionnumber",
  studentnumber: "admissionnumber",
  studentno: "admissionnumber",
  studentcode: "admissionnumber",
  surname: "lastname",
  lastnames: "lastname",
  name: "firstname",
  firstnames: "firstname",
  middlenames: "middlename",
  preferredname: "othernames",
  nickname: "othernames",
  knownas: "othernames",
  sex: "gender",
  dob: "dateofbirth",
  birthdate: "dateofbirth",
  dateofbirthdmy: "dateofbirth",
  idno: "idnumber",
  idpassportno: "idnumber",
  identitynumber: "idnumber",
  homelanguage: "language",
  homelang1: "language",
  previousschool: "prevschool",
  entrydate: "dateofentry",
  startdate: "dateofentry",
  applicationdate: "dateofapplication",
  countryofbirth: "bornin",
  stage: "grade",
  gradecode: "grade",
};

export type HeaderMap<K extends string> = { map: Array<K | null>; unknown: string[]; missing: K[] };

export function mapStudentHeaders(headers: readonly string[]): HeaderMap<StudentKey> {
  const map = headers.map((h) => {
    const k = headerKey(h);
    if ((STUDENT_KEYS as readonly string[]).includes(k)) return k as StudentKey;
    return STUDENT_ALIASES[k] ?? null;
  });
  const unknown = headers.filter((h, i) => map[i] === null && h.trim() !== "");
  const present = new Set(map.filter((m): m is StudentKey => m !== null));
  const missing = (["familycode", "firstname", "lastname", "grade", "dateofbirth"] as const).filter((c) => !present.has(c));
  return { map, unknown, missing };
}

/** Which sheet of a workbook is the students sheet: the first with a first name, a last name and a grade. */
export function findStudentTable(tables: readonly Table[]): Table | null {
  for (const t of tables) {
    const { missing } = mapStudentHeaders(t.headers);
    if (!missing.includes("firstname") && !missing.includes("lastname") && !missing.includes("grade")) return t;
  }
  return null;
}

/** What Ed-admin calls a stage at a campus, and what that is here. */
export type GradeMapping = { code: string; campusId: string; campusName: string; gradeId: string; gradeName: string };

export type StudentImportStatus = "active" | "left" | "graduated";

export type StudentImportRecord = {
  family_code: string;
  admission_number: string | null;
  grade_code: string;
  campus_id: string;
  campus_name: string;
  grade_id: string;
  grade_name: string;
  first_name: string;
  middle_names: string | null;
  last_name: string;
  preferred_name: string | null;
  gender: "female" | "male" | null;
  date_of_birth: string;
  place_of_birth: string | null;
  nationality: string | null;
  country_of_birth: string | null;
  identity_number: string | null;
  home_language: string | null;
  previous_school: string | null;
  date_of_entry: string | null;
  status: StudentImportStatus;
  status_raw: string;
};

export type StudentVerdict = { ok: true; record: StudentImportRecord; warnings: string[] } | { ok: false; errors: string[] };

/**
 * Their Status column in our words. `Current` is theirs for a child at
 * school (the export writes it); a graduate and a leaver are read off the
 * word; anything else is refused rather than guessed, since an applicant or
 * a cancelled record is not a child on the register.
 */
export function studentStatusFrom(raw: string): { status: StudentImportStatus; warning?: string } | { error: string } {
  const s = raw.trim().toLowerCase();
  if (!s) return { status: "active", warning: "No status given; recorded as a current student." };
  if (s === ED_ADMIN.studentStatus.toLowerCase() || s === "active" || s === "enrolled" || s === "attending") return { status: "active" };
  if (/grad|complet|alumni/.test(s)) return { status: "graduated" };
  if (/left|leaver|withdr|inactive|past|cancel|deregist|exit|transfer/.test(s)) return { status: "left" };
  return { error: `Status "${raw.trim()}" is not one this import knows (${ED_ADMIN.studentStatus}, Left, Graduated).` };
}

export function genderFrom(raw: string): "female" | "male" | null {
  const s = raw.trim().toLowerCase();
  if (s === "f" || s === "female" || s === "girl") return "female";
  if (s === "m" || s === "male" || s === "boy") return "male";
  return null;
}

export function validateStudentRow(headers: ReadonlyArray<StudentKey | null>, cells: readonly string[], grades: ReadonlyMap<string, GradeMapping>): StudentVerdict {
  const get = (col: StudentKey): string => {
    const i = headers.indexOf(col);
    return i >= 0 ? (cells[i] ?? "").trim() : "";
  };
  const errors: string[] = [];
  const warnings: string[] = [];

  const familyCode = get("familycode").toUpperCase();
  const first = tidyName(get("firstname"));
  const last = tidyName(get("lastname"));
  if (!familyCode) errors.push("Family code is missing.");
  if (!first) errors.push("First name is missing.");
  if (!last) errors.push("Last name is missing.");

  const gradeRaw = get("grade");
  let grade: GradeMapping | null = null;
  if (!gradeRaw) errors.push("Grade is missing.");
  else {
    grade = grades.get(gradeRaw) ?? grades.get(gradeRaw.toLowerCase()) ?? null;
    if (!grade) errors.push(`Grade "${gradeRaw}" is not mapped to a stage at any campus. Map it under Settings, Ed-admin stage names, and try again.`);
  }

  const dobRaw = get("dateofbirth");
  const dob = parseEdAdminDate(dobRaw);
  if (!dobRaw) errors.push("Date of birth is missing.");
  else if (!dob) errors.push(`"${dobRaw}" is not a date this import can read (day/month/year).`);

  const entryRaw = get("dateofentry");
  const entry = parseEdAdminDate(entryRaw);
  if (entryRaw && !entry) warnings.push(`Date of entry "${entryRaw}" could not be read; left blank.`);

  const genderRaw = get("gender");
  const gender = genderFrom(genderRaw);
  if (genderRaw && !gender) warnings.push(`Gender "${genderRaw}" is not F or M; left blank.`);

  const statusRaw = get("status");
  const st = studentStatusFrom(statusRaw);
  if ("error" in st) errors.push(st.error);
  else if (st.warning) warnings.push(st.warning);

  if (errors.length || !grade || !dob || "error" in st) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    record: {
      family_code: familyCode,
      admission_number: get("admissionnumber") || null,
      grade_code: grade.code,
      campus_id: grade.campusId,
      campus_name: grade.campusName,
      grade_id: grade.gradeId,
      grade_name: grade.gradeName,
      first_name: first,
      middle_names: tidyName(get("middlename")) || null,
      last_name: last,
      preferred_name: tidyName(get("othernames")) || null,
      gender,
      date_of_birth: dob,
      place_of_birth: get("placeofbirth") || null,
      nationality: get("nationality") || null,
      country_of_birth: get("bornin") || null,
      identity_number: get("idnumber") || null,
      home_language: get("language") || null,
      previous_school: get("prevschool") || null,
      date_of_entry: entry,
      status: st.status,
      status_raw: statusRaw,
    },
  };
}

/** Rows that repeat an admission number, or the same child (name and birthday) in the same family, earlier in the file. */
export function duplicateStudentsWithinFile(records: ReadonlyArray<{ index: number; record: StudentImportRecord }>): Map<number, string> {
  const byAdmission = new Map<string, number>();
  const byChild = new Map<string, number>();
  const out = new Map<number, string>();
  for (const { index, record } of records) {
    if (record.admission_number) {
      const a = byAdmission.get(record.admission_number.toLowerCase());
      if (a !== undefined) {
        out.set(index, `Same admission number as row ${a + 1}.`);
        continue;
      }
      byAdmission.set(record.admission_number.toLowerCase(), index);
    }
    const key = `${record.family_code}|${record.first_name.toLowerCase()}|${record.last_name.toLowerCase()}|${record.date_of_birth}`;
    const c = byChild.get(key);
    if (c !== undefined) {
      out.set(index, `Same child as row ${c + 1}.`);
      continue;
    }
    byChild.set(key, index);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

const CODE_KEYS = ["familysponsorcode", "familycode", "familyspnsorcode", "sponsorcode", "family"];

/** One family's cells from every sheet, first non-empty value per column wins. */
export type MergedFamily = { code: string; fields: Map<string, string>; sheets: string[]; firstRow: { sheet: string; row: number } };

export type MergeReport = {
  families: MergedFamily[];
  /** Sheets with no family code column, which the merge could not use. */
  skippedSheets: string[];
  /** Rows on a usable sheet with no family code, by sheet. */
  rowsWithoutCode: Array<{ sheet: string; rows: number }>;
};

/**
 * Their workbook is several narrow sheets keyed on the family code; a flat
 * export from a report is one wide sheet. Both become one record per
 * family: every sheet is walked in order and each family collects the
 * columns it has not seen yet.
 */
export function mergeParentTables(tables: readonly Table[]): MergeReport {
  const families = new Map<string, MergedFamily>();
  const skippedSheets: string[] = [];
  const rowsWithoutCode: Array<{ sheet: string; rows: number }> = [];
  for (const t of tables) {
    const keys = keysOf(t);
    const codeIdx = keys.findIndex((k) => CODE_KEYS.includes(k));
    if (codeIdx < 0) {
      skippedSheets.push(t.name);
      continue;
    }
    let missing = 0;
    t.rows.forEach((cells, r) => {
      if (!cells.some((c) => c.trim() !== "")) return;
      const code = (cells[codeIdx] ?? "").trim().toUpperCase();
      if (!code) {
        missing += 1;
        return;
      }
      let fam = families.get(code);
      if (!fam) {
        fam = { code, fields: new Map(), sheets: [], firstRow: { sheet: t.name, row: r + 1 } };
        families.set(code, fam);
      }
      if (!fam.sheets.includes(t.name)) fam.sheets.push(t.name);
      keys.forEach((k, i) => {
        if (i === codeIdx || !k) return;
        const v = (cells[i] ?? "").trim();
        if (v && !fam.fields.has(k)) fam.fields.set(k, v);
      });
    });
    if (missing) rowsWithoutCode.push({ sheet: t.name, rows: missing });
  }
  return { families: [...families.values()], skippedSheets, rowsWithoutCode };
}

export type GuardianImport = {
  first_name: string;
  last_name: string;
  title: string | null;
  relation_raw: string | null;
  relationship: GuardianRelationship;
  gender: "F" | "M" | null;
  email: string | null;
  email_normalised: string | null;
  mobile: string | null;
  mobile_normalised: string | null;
  nationality: string | null;
  language: string | null;
  id_number: string | null;
  address: string | null;
};

export type ParentImportRecord = {
  family_code: string;
  family_name: string;
  guardians: GuardianImport[];
  /** The guardian who becomes the primary contact: the first with an email address. */
  primary_index: number;
  home_language: string | null;
  address: string | null;
  record_status: string | null;
  /** What their sheets hold that we have no column for, kept as words on the family. */
  notes: string | null;
};

export type ParentVerdict = { ok: true; record: ParentImportRecord; warnings: string[] } | { ok: false; errors: string[] };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Their Relation list, gendered nearly throughout, into our six words. The
 * export goes the other way in `fromGuardian`; this is its inverse where an
 * inverse exists, and "other" where it does not.
 */
export function relationshipFrom(raw: string | null | undefined): GuardianRelationship {
  const r = (raw ?? "").trim().toLowerCase();
  if (!r) return "parent";
  if (/^(step-?)?mother$/.test(r)) return "mother";
  if (/^(step-?)?father$/.test(r)) return "father";
  if (/^grand(mother|father|parent)/.test(r)) return "grandparent";
  if (/guardian|sponsor/.test(r)) return "guardian";
  if (r === "parent") return "parent";
  return "other";
}

function guardianGender(raw: string | null | undefined, title: string | null, relationship: GuardianRelationship): "F" | "M" | null {
  const g = (raw ?? "").trim().toUpperCase();
  if (g === "F" || g === "FEMALE") return "F";
  if (g === "M" || g === "MALE") return "M";
  if (relationship === "mother") return "F";
  if (relationship === "father") return "M";
  if (title === "Mr") return "M";
  if (title === "Mrs" || title === "Miss" || title === "Ms") return "F";
  return null;
}

/** `g1lastname`, or the compact `g2lname`: the first of the names that has a value. */
function field(f: ReadonlyMap<string, string>, prefix: "g1" | "g2", names: readonly string[]): string {
  for (const n of names) {
    const v = f.get(prefix + n);
    if (v) return v;
  }
  return "";
}

function guardianAddress(f: ReadonlyMap<string, string>, prefix: "g1" | "g2"): string | null {
  const lines = [
    field(f, prefix, ["addr1", "resaddr1", "address1", "address"]),
    field(f, prefix, ["addr2", "resaddr2", "address2"]),
    field(f, prefix, ["addr3", "resaddr3", "address3"]),
    field(f, prefix, ["addr4", "resaddr4", "address4"]),
  ].filter(Boolean);
  const post = field(f, prefix, ["respostcode", "postcode"]);
  if (post) lines.push(post);
  return lines.length ? lines.join(", ") : null;
}

function readGuardian(f: ReadonlyMap<string, string>, prefix: "g1" | "g2"): GuardianImport | null {
  const first = tidyName(field(f, prefix, ["firstname", "fname", "firstnames", "name"]));
  const last = tidyName(field(f, prefix, ["lastname", "lname", "surname"]));
  if (!first && !last) return null;
  const titleRaw = field(f, prefix, ["title"]);
  const title = ED_ADMIN.titles.find((t) => t.toLowerCase() === titleRaw.toLowerCase()) ?? (titleRaw || null);
  const relationRaw = field(f, prefix, ["relation", "relationship"]) || null;
  const relationship = relationshipFrom(relationRaw);
  const emailRaw = field(f, prefix, ["email", "emailaddress"]);
  const email = EMAIL_SHAPE.test(emailRaw) ? emailRaw : null;
  const mobileRaw = field(f, prefix, ["cell", "cellphone", "mobile", "homephone", "workphone"]);
  return {
    first_name: first,
    last_name: last,
    title,
    relation_raw: relationRaw,
    relationship,
    gender: guardianGender(field(f, prefix, ["gender", "sex"]), title, relationship),
    email,
    email_normalised: email ? normaliseEmail(email) : null,
    mobile: mobileRaw || null,
    mobile_normalised: mobileRaw ? normaliseMobile(mobileRaw) : null,
    nationality: field(f, prefix, ["nationality"]) || null,
    language: field(f, prefix, ["language", "homelanguage"]) || null,
    id_number: field(f, prefix, ["idpassportno", "idnumber", "idno"]) || null,
    address: guardianAddress(f, prefix),
  };
}

function emergencyNotes(f: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const prefix of ["g1", "g2"] as const) {
    for (const n of [1, 2, 3]) {
      const name = field(f, prefix, [`emergname${n}`, `emerg${n}name`]);
      if (!name) continue;
      const rel = field(f, prefix, [`emergrel${n}`, `emerg${n}rel`, `emerg${n}rela`]);
      const cont = field(f, prefix, [`emergcont${n}`, `emerg${n}cont`]);
      out.push(`Emergency contact: ${name}${rel ? ` (${rel})` : ""}${cont ? `, ${cont}` : ""}`);
    }
  }
  return [...new Set(out)];
}

function describe(g: GuardianImport): string {
  return [g.title, g.first_name, g.last_name].filter(Boolean).join(" ");
}

export function validateParentRecord(fam: MergedFamily): ParentVerdict {
  const f = fam.fields;
  const errors: string[] = [];
  const warnings: string[] = [];
  const g1 = readGuardian(f, "g1");
  const g2 = readGuardian(f, "g2");
  const guardians = [g1, g2].filter((g): g is GuardianImport => g !== null);
  if (!g1) errors.push("The first guardian has no name.");
  else {
    if (!g1.first_name) errors.push("The first guardian has no first name.");
    if (!g1.last_name) errors.push("The first guardian has no last name.");
  }
  for (const g of guardians) {
    const raw = g === g1 ? field(f, "g1", ["email", "emailaddress"]) : field(f, "g2", ["email", "emailaddress"]);
    if (raw && !g.email) warnings.push(`"${raw}" is not an email address; ${describe(g)} is recorded without one.`);
    if (g.mobile && !g.mobile_normalised) warnings.push(`Number "${g.mobile}" for ${describe(g)} could not be read as a Botswana or South African number; kept as typed.`);
    if (g.relation_raw && g.relationship === "other" && !/family|relative|friend|alternative|cousin|aunt|uncle|sister|brother|nephew|niece/i.test(g.relation_raw)) {
      warnings.push(`Relation "${g.relation_raw}" for ${describe(g)} is recorded as "other".`);
    }
  }
  const primary = guardians.findIndex((g) => g.email !== null);
  if (guardians.length && primary < 0) {
    errors.push("Neither guardian has an email address. A contact needs one: add it in Ed-admin and export again, or add the family by hand.");
  }
  const secondWithoutEmail = guardians.filter((g, i) => i !== primary && !g.email);
  const notes: string[] = [];
  for (const g of secondWithoutEmail) {
    warnings.push(`${describe(g)} has no email address and is noted on the family rather than added as a contact.`);
    notes.push(`Also in Ed-admin: ${describe(g)}${g.relation_raw ? ` (${g.relation_raw})` : ""}${g.mobile ? `, ${g.mobile}` : ""}, no email address.`);
  }
  notes.push(...emergencyNotes(f));
  const recordStatus = f.get("recordstatus") ?? f.get("familysponsorstatus") ?? null;
  if (recordStatus && recordStatus.toLowerCase() !== ED_ADMIN.studentStatus.toLowerCase()) {
    warnings.push(`Record status is "${recordStatus}", not ${ED_ADMIN.studentStatus}.`);
  }
  if (errors.length || !g1) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    record: {
      family_code: fam.code,
      family_name: g1.last_name,
      guardians,
      primary_index: primary,
      home_language: f.get("homelang1") ?? g1.language ?? null,
      address: g1.address ?? g2?.address ?? null,
      record_status: recordStatus,
      notes: notes.length ? notes.join("\n") : null,
    },
  };
}

/** Families whose primary email, or a guardian's number, already belongs to an earlier family in the file. */
export function duplicateParentsWithinFile(records: ReadonlyArray<{ index: number; record: ParentImportRecord }>): Map<number, string> {
  const seenEmail = new Map<string, string>();
  const seenMobile = new Map<string, string>();
  const out = new Map<number, string>();
  for (const { index, record } of records) {
    let dup: string | null = null;
    for (const g of record.guardians) {
      if (g.email_normalised) {
        const e = seenEmail.get(g.email_normalised);
        if (e && e !== record.family_code) dup = dup ?? `Same email address as family ${e}.`;
      }
      if (g.mobile_normalised) {
        const m = seenMobile.get(g.mobile_normalised);
        if (m && m !== record.family_code) dup = dup ?? `Same mobile number as family ${m}.`;
      }
    }
    if (dup) {
      out.set(index, dup);
      continue;
    }
    for (const g of record.guardians) {
      if (g.email_normalised && !seenEmail.has(g.email_normalised)) seenEmail.set(g.email_normalised, record.family_code);
      if (g.mobile_normalised && !seenMobile.has(g.mobile_normalised)) seenMobile.set(g.mobile_normalised, record.family_code);
    }
  }
  return out;
}

/** Which of the two Ed-admin files this is, by what its sheets carry. */
export function detectEdAdminKind(tables: readonly Table[]): "ed_admin_students" | "ed_admin_parents" | null {
  if (findStudentTable(tables)) return "ed_admin_students";
  for (const t of tables) {
    const keys = keysOf(t);
    if (keys.some((k) => CODE_KEYS.includes(k)) && keys.some((k) => /^g1(lastname|firstname|lname|fname|email|cell)$/.test(k))) return "ed_admin_parents";
  }
  return null;
}
