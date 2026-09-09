import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";

/**
 * The two files the school's other system takes: one of parents, one of
 * students, in the exact column order of its own template.
 *
 * Three rules come from that system, not from us, and each one shapes this
 * file:
 *
 *  1. **Parent details and student details never travel together.** Two
 *     files, two column lists, and nothing from one appears in the other.
 *     The single exception is the family code, which is the only way the
 *     two files can be matched up on arrival — their template asks for it
 *     in both.
 *  2. **The family code is the account.** It is stable per family (see
 *     `contacts.family_code`), so a second child joins the account the first
 *     one opened and the school sends one statement.
 *  3. **The columns are theirs.** Header text is reproduced exactly as their
 *     template spells it — `G1 Slautation` included. Do not tidy it: their
 *     importer matches on the string.
 *
 * Columns we do not collect (employer, passport number, debit order, and so
 * on) are present and empty rather than absent, because a row has to have the
 * same shape as the header.
 */

/** How a date is written for their importer. Their template holds real dates, not text. */
export type DateStyle = "dmy" | "ymd";

export function formatDate(iso: string | null | undefined, style: DateStyle = "dmy"): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const [, y, mo, d] = m;
  return style === "ymd" ? `${y}/${mo}/${d}` : `${d}/${mo}/${y}`;
}

/** One guardian's block of columns, repeated for G1 and G2. */
function guardianColumns(g: "G1" | "G2"): string[] {
  return [
    `${g} Last Name`,
    `${g} First Name`,
    `${g} Title`,
    `${g} Relation`,
    `${g} Home Phone`,
    `${g} Cell`,
    `${g} Email`,
    `${g} Prof.`,
    `${g} Employer`,
    `${g} Work Phone`,
    `${g} Work Fax`,
    `${g} Nationality`,
    `${g} Lang.`,
    `${g} Pass No`,
    // Their spelling, deliberately kept.
    `${g} Slautation`,
    `${g} Addr 1`,
    `${g} Addr 2`,
    `${g} Addr 3`,
    `${g} Addr 4`,
    `${g} Post Code`,
    `${g} Res. Addr 1`,
    `${g} Res. Addr 2`,
    `${g} Res. Addr 3`,
    `${g} Res. Addr 4`,
    `${g} Res. Post Code`,
    `${g} Emerg. Name 1`,
    `${g} Emerg. Rel. 1`,
    `${g} Emerg. Cont. 1`,
    `${g} Emerg. Name 2`,
    `${g} Emerg. Rel. 2`,
    `${g} Emerg. Cont. 2`,
    `${g} Emerg. Name 3`,
    `${g} Emerg. Rel. 3`,
    `${g} Emerg. Cont. 3`,
  ];
}

export const PARENT_COLUMNS: readonly string[] = [
  "Family Code*",
  ...guardianColumns("G1"),
  ...guardianColumns("G2"),
  "Home Lang. 1",
  "Home Lang. 2",
  "Home Lang. 3",
  "Inv. Addr (0/1/2)",
  "G1 Invoice",
  "G2 Invoice",
  "Inv. Addr 1",
  "Inv. Addr 2",
  "Inv. Addr 3",
  "Inv. Addr 4",
  "Inv. Post Code",
  "Inv. Res. Addr 1",
  "Inv. Res. Addr 2",
  "Inv. Res. Addr 3",
  "Inv. Res. Addr 4",
  "Inv. Res. Post Code",
  "Inv. Phone",
  "Inv. Cell",
  "Inv. Email",
  "Inv. Fax",
  "Debit Order",
  "DO Day of Month",
  "DO Bank Name",
  "DO Branch Code",
  "DO Branch Name",
  "DO Acc. No",
  "DO Acc. Name",
];

export const STUDENT_COLUMNS: readonly string[] = [
  "Family Code*",
  "Admission Number*",
  "Grade*",
  "Class",
  "Last Name*",
  "First Name*",
  "Middle Name",
  "Other Names",
  "Gender*",
  "Date of Birth*",
  "Place Of Birth",
  "Nationality",
  "Born in",
  "Religion",
  "ID Number",
  "Email",
  "Cell",
  "Student Type",
  "Keyword",
  "Lang. Prev. School",
  "Language",
  "Lang. Level",
  "Language 2",
  "Lang. 2 Level",
  "Language 3",
  "Lang. 3 Level",
  "Language 4",
  "Lang. 4 Level",
  "Prev. School",
  "Date of Application*",
  "Date of Entry*",
  "Sponsor",
  "Status",
];

/**
 * One address field becomes four lines. We ask a parent for their address as
 * a block of text, and their system wants it split; anything past the fourth
 * line is folded into it rather than dropped.
 */
export function addressLines(address: string | null | undefined): [string, string, string, string] {
  const parts = (address ?? "")
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 4) {
    return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", parts[3] ?? ""];
  }
  return [parts[0], parts[1], parts[2], parts.slice(3).join(", ")];
}

/** "Mr"/"Mrs" is not asked for; the relationship is the closest honest guess. */
function titleFor(relationship: string | null | undefined): string {
  const r = (relationship ?? "").toLowerCase();
  if (r === "mother" || r === "stepmother") return "Mrs";
  if (r === "father" || r === "stepfather") return "Mr";
  return "";
}

type Guardian = StudentRecordSnapshot["guardians"][number];
type Emergency = StudentRecordSnapshot["emergency_contacts"][number];

/**
 * The emergency slots hang off a guardian in their template; we hold them for
 * the family. They go under G1, which is where somebody reading the row will
 * look for them, and G2's stay empty.
 */
function guardianValues(g: Guardian | undefined, emergencies: Emergency[]): string[] {
  if (!g) return new Array(34).fill("");
  const [a1, a2, a3, a4] = addressLines(g.address);
  const title = titleFor(g.relationship);
  const e = (i: number, field: "name" | "rel" | "cont"): string => {
    const c = emergencies[i];
    if (!c) return "";
    if (field === "name") return `${c.first_name} ${c.last_name}`.trim();
    if (field === "rel") return c.relationship ?? "";
    return c.phone ?? c.email ?? "";
  };
  return [
    g.last_name ?? "",
    g.first_name ?? "",
    title,
    g.relationship ?? "",
    g.phone ?? "",
    g.mobile ?? "",
    g.email ?? "",
    "", // Prof. — not collected
    "", // Employer — not collected
    "", // Work Phone
    "", // Work Fax
    g.nationality ?? "",
    "", // Lang.
    "", // Pass No
    [title, g.first_name, g.last_name].filter(Boolean).join(" "),
    a1,
    a2,
    a3,
    a4,
    "", // Post Code — not collected
    a1,
    a2,
    a3,
    a4,
    "", // Res. Post Code
    e(0, "name"),
    e(0, "rel"),
    e(0, "cont"),
    e(1, "name"),
    e(1, "rel"),
    e(1, "cont"),
    e(2, "name"),
    e(2, "rel"),
    e(2, "cont"),
  ];
}

/**
 * One family, as their parent file wants it. Nothing about the child appears
 * here — not the name, not the grade, not the date of birth.
 */
export function parentRow(record: StudentRecordSnapshot, familyCode: string): string[] {
  const [g1, g2] = record.guardians;
  const [i1, i2, i3, i4] = addressLines(g1?.address);
  return [
    familyCode,
    ...guardianValues(g1, record.emergency_contacts),
    ...guardianValues(g2, []),
    record.student.home_language ?? "",
    "",
    "",
    // Which address the invoice goes to: 1 = the first guardian's.
    g1 ? "1" : "0",
    g1 ? "1" : "0",
    "0",
    i1,
    i2,
    i3,
    i4,
    "", // Inv. Post Code
    "",
    "",
    "",
    "",
    "", // Inv. Res. block
    g1?.phone ?? "",
    g1?.mobile ?? "",
    g1?.email ?? "",
    "", // Inv. Fax
    "OFF", // Debit Order — the school sets these up itself
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

/**
 * One child, as their student file wants it. Nothing about the parents
 * appears here beyond the family code that ties the two files together.
 */
export function studentRow(
  record: StudentRecordSnapshot,
  familyCode: string,
  opts: { dateStyle?: DateStyle; status?: string; enquiredAt?: string | null } = {}
): string[] {
  const style = opts.dateStyle ?? "dmy";
  const s = record.student;
  return [
    familyCode,
    record.application.reference,
    record.application.grade,
    "", // Class — set by the school on arrival
    s.legal_last_name ?? "",
    s.legal_first_name ?? "",
    s.legal_middle_names ?? "",
    s.preferred_name ?? "",
    (s.gender ?? "").slice(0, 1).toUpperCase(),
    formatDate(s.date_of_birth, style),
    s.place_of_birth ?? "",
    s.nationality ?? "",
    s.country_of_birth ?? "",
    "", // Religion — not collected
    s.identity_number ?? "",
    "", // the child's own email and mobile are not collected
    "",
    "", // Student Type — day or boarding, set by the school
    "", // Keyword
    "", // Lang. Prev. School
    s.home_language ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    s.previous_institution ?? "",
    formatDate(opts.enquiredAt ?? null, style),
    formatDate(record.application.start_date, style),
    "", // Sponsor
    opts.status ?? "Active",
  ];
}
