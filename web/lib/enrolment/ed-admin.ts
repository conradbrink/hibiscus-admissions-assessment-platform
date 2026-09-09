import accepted from "@/content/enrolment/accepted-values.json";
import edAdminCodes from "@/content/enrolment/ed-admin-codes.json";
import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";
import { buildWorkbook, type Sheet } from "@/lib/enrolment/xlsx";

/**
 * The two workbooks the school's other system imports, shaped like its own
 * templates (`Admissions_Student.xlsx`, `Parents_Sponsors_Debtors Import
 * New.xls`).
 *
 * Four things come from that system, not from us:
 *
 *  1. **Parents and students are separate files.** Nothing about a child
 *     appears in the parent workbook and nothing about a parent in the
 *     student one. The family code is in both, because it is the only thing
 *     that joins them — and it is what puts siblings on one account.
 *  2. **The parent import is a workbook of narrow sheets**, not one wide
 *     sheet: Basic, then a contact and an address sheet per guardian, then
 *     the account. Each is keyed on the family code. A single flat CSV is
 *     refused, which is what happened the first time.
 *  3. **Headers are reproduced exactly**, including their inconsistencies —
 *     `Family/Sponsor Code*` on one sheet and `Family/SponsorCode*` on the
 *     next, the postal block on `G1 Address` labelled `Res.`, and `G2
 *     Address` using compact names like `G2LName`. Tidying any of it would
 *     break the match.
 *  4. **Nationality and language must come from their own lists.** Their
 *     workbook says: "Any other form of spelling will not be imported." So a
 *     value we hold that is not on the list is sent empty rather than
 *     risking the row, and the export reports how many it dropped.
 */

const LANGUAGES = new Set(accepted.languages);
const NATIONALITIES = new Set(accepted.nationalities);

/**
 * Ed-admin's own dropdown lists, copied from the school's live system. Its
 * importer matches the exact string and drops anything else in silence, so
 * every value we put in a constrained column comes from here.
 */
export const ED_ADMIN = edAdminCodes as {
  note: string;
  grades: string[];
  relations: string[];
  titles: string[];
  studentStatus: string;
  genders: string[];
};

export type DateStyle = "dmy" | "ymd";

export function formatDate(iso: string | null | undefined, style: DateStyle = "dmy"): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const [, y, mo, d] = m;
  return style === "ymd" ? `${y}/${mo}/${d}` : `${d}/${mo}/${y}`;
}

/**
 * A telephone number as their samples write them: digits, no plus. A leading
 * `+` would also be prefixed with an apostrophe by a spreadsheet guard.
 * Botswana's own code is dropped; another country's is kept, since without it
 * the number is unreachable.
 */
export function phoneFor(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  const bare = digits.replace(/^\+/, "");
  return bare.startsWith("267") && bare.length > 8 ? bare.slice(3) : bare;
}

/** Their list or nothing. A spelling they do not know stops the value, not the row. */
export function acceptedLanguage(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return LANGUAGES.has(v) ? v : "";
}

export function acceptedNationality(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return NATIONALITIES.has(v) ? v : "";
}

export function addressLines(address: string | null | undefined): [string, string, string, string] {
  const parts = (address ?? "")
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 4) return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", parts[3] ?? ""];
  return [parts[0], parts[1], parts[2], parts.slice(3).join(", ")];
}

/** Their Title, Relation and Gender columns are required and come from one answer. */
/**
 * A guardian in Ed-admin's words: their title, their sex, and the one entry
 * from their Relation list that fits.
 *
 * Their Relation list is gendered nearly throughout — `Guardian (female)` and
 * `Guardian (male)` but no plain `Guardian`, `Grandmother` and `Grandfather`
 * but no `Grandparent` — and Title and Gender are both required columns. None
 * of that can be answered by a relationship alone, and none of it may be
 * guessed from a first name.
 *
 * So registration asks for a title, and the sex follows from it where the
 * title carries one. A relationship that already implies a sex (mother,
 * father) answers for itself, so an older record with no title still exports.
 * A doctor who is a guardian gives neither, and comes back empty to be
 * reported rather than guessed.
 */
const TITLE_SEX: Record<string, "F" | "M"> = {
  Mr: "M",
  Mrs: "F",
  Miss: "F",
  Ms: "F",
  Prince: "M",
  Princess: "F",
  Nkosi: "M",
};

function fromGuardian(g: Guardian | undefined): { title: string; relation: string; gender: string } {
  if (!g) return { title: "", relation: "", gender: "" };
  const r = (g.relationship ?? "").toLowerCase();
  const title = g.title && ED_ADMIN.titles.includes(g.title) ? g.title : "";

  // What the relationship settles on its own, whatever the title says.
  if (r === "mother" || r === "stepmother" || r === "step-mother") return { title: title || "Mrs", relation: "Mother", gender: "F" };
  if (r === "father" || r === "stepfather" || r === "step-father") return { title: title || "Mr", relation: "Father", gender: "M" };
  if (r === "grandmother") return { title: title || "Mrs", relation: "Grandmother", gender: "F" };
  if (r === "grandfather") return { title: title || "Mr", relation: "Grandfather", gender: "M" };
  if (r === "aunt") return { title: title || "Mrs", relation: "Aunt", gender: "F" };
  if (r === "sister") return { title: title || "Miss", relation: "Sister", gender: "F" };
  if (r === "brother") return { title: title || "Mr", relation: "Brother", gender: "M" };

  // Everything else needs the title to say which of the pair to send.
  const sex = TITLE_SEX[title];
  if (!sex) return { title, relation: "", gender: "" };
  const suffix = sex === "F" ? "(female)" : "(male)";
  if (r === "grandparent") return { title, relation: sex === "F" ? "Grandmother" : "Grandfather", gender: sex };
  if (r === "guardian" || r === "parent") return { title, relation: `Guardian ${suffix}`, gender: sex };
  return { title, relation: `Family ${suffix}`, gender: sex };
}

/** The guardians whose relationship Ed-admin has no word for, so staff can set one. */
export function unmappedRelationships(families: FamilyExport[]): string[] {
  const out = new Set<string>();
  for (const f of families) {
    for (const g of f.record.guardians) {
      if (!fromGuardian(g).relation) out.add(`${g.first_name} ${g.last_name} (${g.relationship || "no relationship"})`);
    }
  }
  return [...out].sort();
}

type Guardian = StudentRecordSnapshot["guardians"][number];
type Emergency = StudentRecordSnapshot["emergency_contacts"][number];

/** One family: the record, the code, and the enquiry date for the student sheet. */
export type FamilyExport = {
  familyCode: string;
  record: StudentRecordSnapshot;
  enquiredAt?: string | null;
  /**
   * What Ed-admin calls this child's stage at this campus — `Stage5-HPS`,
   * `NURSERY-TLK`, `RECEP_PHASE_2`. Resolved at export time from
   * `campus_grades.external_grade_code` rather than read from the snapshot,
   * so a stage the school renames in Ed-admin is right on the next download
   * without rewriting frozen records.
   */
  externalGradeCode?: string | null;
};

// ---------------------------------------------------------------------------
// The student workbook — one sheet, their header row exactly
// ---------------------------------------------------------------------------

export const STUDENT_COLUMNS: readonly string[] = [
  "Family Code*", "Admission Number*", "Grade*", "Class", "Last Name*", "First Name*", "Middle Name",
  "Other Names", "Gender*", "Date of Birth*", "Place Of Birth", "Nationality", "Born in", "Religion",
  "ID Number", "Email", "Cell", "Student Type", "Keyword", "Lang. Prev. School", "Language", "Lang. Level",
  "Language 2", "Lang. 2 Level", "Language 3", "Lang. 3 Level", "Language 4", "Lang. 4 Level",
  "Prev. School", "Date of Application*", "Date of Entry*", "Sponsor", "Status",
];

export function studentRow(f: FamilyExport, opts: { dateStyle?: DateStyle; status?: string } = {}): string[] {
  const style = opts.dateStyle ?? "dmy";
  const s = f.record.student;
  return [
    f.familyCode,
    f.record.application.reference,
    // Their word for the stage, never ours. `Stage 5` is not a grade in
    // Ed-admin and importing it loses the child's grade and, with it, the
    // link to the family; the export refuses to send an unmapped pair.
    f.externalGradeCode ?? "",
    "",
    s.legal_last_name ?? "",
    s.legal_first_name ?? "",
    s.legal_middle_names ?? "",
    s.preferred_name ?? "",
    (s.gender ?? "").slice(0, 1).toUpperCase(),
    formatDate(s.date_of_birth, style),
    s.place_of_birth ?? "",
    acceptedNationality(s.nationality),
    s.country_of_birth ?? "",
    "",
    s.identity_number ?? "",
    "", "",
    "", "", "",
    acceptedLanguage(s.home_language),
    "", "", "", "", "", "", "",
    s.previous_institution ?? "",
    formatDate(f.enquiredAt ?? null, style),
    formatDate(f.record.application.start_date, style),
    "",
    opts.status ?? ED_ADMIN.studentStatus,
  ];
}

export function studentWorkbook(families: FamilyExport[], opts?: { dateStyle?: DateStyle; status?: string }): Buffer {
  return buildWorkbook([{ name: "Sheet1", headers: STUDENT_COLUMNS, rows: families.map((f) => studentRow(f, opts)) }]);
}

// ---------------------------------------------------------------------------
// The parent workbook — their sheets, their spellings
// ---------------------------------------------------------------------------

export const BASIC_COLUMNS: readonly string[] = [
  "Family/Sponsor Code*", "G1 Last Name*", "G1 First Name*", "G1 Title*", "G1 Relation*", "G1 Gender*",
  "G2 Last Name", "G2 First Name", "G2 Title", "G2 Relation", "G2 Gender",
  "Home Lang. 1", "Home Lang. 2", "Home Lang. 3", "Family/Sponsor Status", "Record Status*", "Family Salutation*",
];

const contactColumns = (g: "G1" | "G2"): string[] => [
  // Their own inconsistency: a space after "Family/Sponsor" on G1 and G2's
  // Basic sheet, none on the address sheets. Reproduced, not corrected.
  g === "G1" ? "Family/SponsorCode*" : "Family/Sponsor Code*",
  `${g} Last Name`, `${g} First Name`, `${g} Home Phone`, `${g} Cell`, `${g} Email`,
  `${g} Profession`, `${g} Company`, `${g} Work Phone`, `${g} Work Fax`,
  `${g} Nationality`, `${g} Language`, `${g} ID/Passport No`, `${g} Salutation`,
];

export const G1_CONTACT_COLUMNS: readonly string[] = contactColumns("G1");
export const G2_CONTACT_COLUMNS: readonly string[] = contactColumns("G2");

/** Their G1 sheet labels the postal block "Res." too. Kept as it is. */
export const G1_ADDRESS_COLUMNS: readonly string[] = [
  "Family/SponsorCode*", "G1 Last Name", "G1 First Name",
  "G1 Addr 1", "G1 Res. Addr 2", "G1 Res. Addr 3", "G1 Res. Addr 4", "G1 Res. Post Code",
  "G1 Res. Addr 1", "G1 Res. Addr 2", "G1 Res. Addr 3", "G1 Res. Addr 4", "G1 Res. Post Code",
  "G1 Emerg. Name 1", "G1 Emerg. Rel 1", "G1 Emerg. Cont.1",
  "G1 Emerg. Name 2", "G1 Emerg. Rel 2", "G1 Emerg. Cont. 2",
  "G1 Emerg. Name 3", "G1 Emerg. Rel. 3", "G1 Emerg. Cont. 3",
];

/** G2's address sheet uses compact names. Also theirs. */
export const G2_ADDRESS_COLUMNS: readonly string[] = [
  "Family/SponsorCode*", "G2LName", "G2FName",
  "G2Addr1", "G2Addr2", "G2Addr3", "G2Addr4", "G2PostCode",
  "G2ResAddr1", "G2ResAddr2", "G2ResAddr3", "G2ResAddr4", "G2ResPostCode",
  "G2Emerg1Name", "G2Emerg1Rela", "G2Emerg1Cont",
  "G2Emerg2Name", "G2Emerg2Rel", "G2Emerg2Cont",
  "G2Emerg3Name", "G2Emerg3Rel", "G2Emerg3Cont",
];

export const ACCOUNTS_COLUMNS: readonly string[] = [
  "Family/SponsorCode*", "Inv. Addr(1/2/E)", "Invoice(1/2/E)*",
  "Inv. Addr 1", "Inv Addr 2", "Inv. Addr 3", "Inv. Addr 4", "Inv. Post Code",
  "Inv. Res. Addr 1", "Inv Res. Addr 2", "Inv Res. Addr 3", "Inv Res. Addr 4", "Inv Res. Post Code",
  "Inv. Phone", "Inv. Cell", "Inv. Email", "Inv. Fax", "Email Statement",
];

function salutation(g1: Guardian | undefined, g2: Guardian | undefined): string {
  if (!g1) return "";
  const a = fromGuardian(g1);
  if (g2 && g2.last_name === g1.last_name) {
    const b = fromGuardian(g2);
    const titles = [b.title, a.title].filter(Boolean).join(" and ");
    return `${titles || "The"} ${g1.last_name} family`.replace(/^The /, "The ").trim();
  }
  return [a.title, g1.first_name, g1.last_name].filter(Boolean).join(" ");
}

export function basicRow(f: FamilyExport): string[] {
  const [g1, g2] = f.record.guardians;
  const a = fromGuardian(g1);
  const b = fromGuardian(g2);
  return [
    f.familyCode,
    g1?.last_name ?? "", g1?.first_name ?? "", a.title, g1 ? a.relation : "", a.gender,
    g2?.last_name ?? "", g2?.first_name ?? "", g2 ? b.title : "", g2 ? b.relation : "", g2 ? b.gender : "",
    acceptedLanguage(f.record.student.home_language), "", "",
    "",
    // Their word for a live record, taken from the same list as everything
    // else here; "Active" is not one of Ed-admin's.
    ED_ADMIN.studentStatus,
    salutation(g1, g2),
  ];
}

function contactRow(f: FamilyExport, g: Guardian | undefined): string[] {
  if (!g) return new Array(G1_CONTACT_COLUMNS.length).fill("");
  const a = fromGuardian(g);
  return [
    f.familyCode,
    g.last_name ?? "", g.first_name ?? "",
    phoneFor(g.phone), phoneFor(g.mobile), g.email ?? "",
    "", "", "", "",
    acceptedNationality(g.nationality), "", "",
    [a.title, g.first_name, g.last_name].filter(Boolean).join(" "),
  ];
}

function addressRow(f: FamilyExport, g: Guardian | undefined, emergencies: Emergency[]): string[] {
  if (!g) return new Array(G1_ADDRESS_COLUMNS.length).fill("");
  const [a1, a2, a3, a4] = addressLines(g.address);
  const e = (i: number, field: "name" | "rel" | "cont"): string => {
    const c = emergencies[i];
    if (!c) return "";
    if (field === "name") return `${c.first_name} ${c.last_name}`.trim();
    if (field === "rel") return c.relationship ?? "";
    return c.phone ? phoneFor(c.phone) : (c.email ?? "");
  };
  return [
    f.familyCode, g.last_name ?? "", g.first_name ?? "",
    a1, a2, a3, a4, "",
    a1, a2, a3, a4, "",
    e(0, "name"), e(0, "rel"), e(0, "cont"),
    e(1, "name"), e(1, "rel"), e(1, "cont"),
    e(2, "name"), e(2, "rel"), e(2, "cont"),
  ];
}

export function accountsRow(f: FamilyExport): string[] {
  const [g1] = f.record.guardians;
  const [a1, a2, a3, a4] = addressLines(g1?.address);
  return [
    f.familyCode,
    // 1 = the first guardian's address, matching their sample row.
    "1", "1",
    a1, a2, a3, a4, "",
    a1, a2, a3, a4, "",
    phoneFor(g1?.phone), phoneFor(g1?.mobile), g1?.email ?? "", "",
    "Yes",
  ];
}

/**
 * One row per family, not per child: two siblings share a family, and sending
 * it twice would either duplicate the account or refuse the batch.
 */
/**
 * One row per FAMILY, never one per child.
 *
 * Two siblings share a family code, and the whole point of the code is that
 * their fees land on one account. A workbook carrying the family twice asks
 * the other system to create the same family twice, and what it does then is
 * its business, not ours. The download route already narrows the selection,
 * but the guarantee belongs here where the file is built: nothing else can
 * hand this function a list it has not deduplicated.
 */
function byFamily(families: FamilyExport[]): FamilyExport[] {
  const seen = new Set<string>();
  return families.filter((f) => (seen.has(f.familyCode) ? false : (seen.add(f.familyCode), true)));
}

export function parentWorkbook(all: FamilyExport[]): Buffer {
  const families = byFamily(all);
  const sheets: Sheet[] = [
    { name: "Basic", headers: BASIC_COLUMNS, rows: families.map(basicRow) },
    { name: "G1 Contact", headers: G1_CONTACT_COLUMNS, rows: families.map((f) => contactRow(f, f.record.guardians[0])) },
    { name: "G1 Address", headers: G1_ADDRESS_COLUMNS, rows: families.map((f) => addressRow(f, f.record.guardians[0], f.record.emergency_contacts)) },
    { name: "G2 Contact", headers: G2_CONTACT_COLUMNS, rows: families.filter((f) => f.record.guardians[1]).map((f) => contactRow(f, f.record.guardians[1])) },
    { name: "G2 Address", headers: G2_ADDRESS_COLUMNS, rows: families.filter((f) => f.record.guardians[1]).map((f) => addressRow(f, f.record.guardians[1], [])) },
    { name: "Accounts (By Family Code)", headers: ACCOUNTS_COLUMNS, rows: families.map(accountsRow) },
  ];
  return buildWorkbook(sheets);
}

/** What was left out because their lists do not carry the spelling we hold. */
export function droppedValues(families: FamilyExport[]): { nationalities: string[]; languages: string[] } {
  const nationalities = new Set<string>();
  const languages = new Set<string>();
  for (const f of families) {
    const check = (v: string | null | undefined, set: Set<string>, ok: (s: string) => string) => {
      const t = (v ?? "").trim();
      if (t && !ok(t)) set.add(t);
    };
    check(f.record.student.nationality, nationalities, acceptedNationality);
    check(f.record.student.home_language, languages, acceptedLanguage);
    for (const g of f.record.guardians) check(g.nationality, nationalities, acceptedNationality);
  }
  return { nationalities: [...nationalities], languages: [...languages] };
}
