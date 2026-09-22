/**
 * The school's scholarship spreadsheet, turned into rows we can act on.
 *
 * Pure: hand it the sheets a workbook reader produced and it hands back
 * records and complaints. Nothing here touches the database, so the whole
 * awkward part — a phone number stored as `7.6795094E7`, two emails in one
 * cell, a missing address, a name with three words in it — is testable
 * against the real file rather than discovered during an import of eighty
 * families.
 *
 * The secondary sheet is the shape this understands:
 *
 *   ''  | APPLICANT NAME | CLASS | PARENT/GUARDIAN | PARENT EMAIL | PARENT CONTACT | AWARD
 *   1.0 | Penelope …     | Form 1| Masego …        | m@example.com| 7.6795094E7    | Academic 50%
 *
 * The primary sheet has no contact columns at all, which is why it cannot be
 * imported and is not pretended about here.
 */

export type RosterRow = {
  /** Where it came from, for a report somebody has to reconcile by eye. */
  sheet: string;
  line: number;
  studentFirstName: string;
  studentLastName: string;
  parentFirstName: string;
  parentLastName: string;
  email: string;
  /** E.164, Botswana. */
  mobile: string;
  /** "Form 1" — the class as written, mapped to a grade by the caller. */
  className: string;
  /** The promotion code the award maps to: `SCHOLARSHIP-50`. */
  promotionCode: string;
  /** Anything worth a human's attention that did not stop the row importing. */
  notes: string[];
};

export type RosterProblem = { sheet: string; line: number; student: string; why: string };

export type RosterResult = { rows: RosterRow[]; problems: RosterProblem[] };

const HEADERS = ["applicant name", "class", "parent/guardian", "parent email", "parent contact", "award"];

/**
 * A Botswana mobile from whatever the cell held.
 *
 * Three shapes appear in the real file: `76795094`, the same number as
 * `7.6795094E7` because a spreadsheet decided it was a float, and
 * `72556155 - 73687525` where a family gave two numbers. The first number
 * wins and the rest become a note — picking one is a decision somebody should
 * be able to see, not a silent truncation.
 */
export function mobilesIn(raw: string): string[] {
  const cell = (raw ?? "").trim();
  if (!cell) return [];
  // A float the spreadsheet made of a phone number. Rounded, because
  // 7.6795094E7 is exactly 76795094 and anything else is not a phone number.
  if (/^\d(\.\d+)?[eE][+]?\d+$/.test(cell)) {
    const n = Number(cell);
    return Number.isFinite(n) ? [String(Math.round(n))] : [];
  }
  return cell
    .split(/[-/,;]|\s+and\s+/i)
    .map((part) => part.replace(/\D/g, ""))
    .filter(Boolean);
}

/** `+267` in front of an eight-digit local number, or null if it is not one. */
export function toBotswanaE164(local: string): string | null {
  const digits = (local ?? "").replace(/\D/g, "");
  const national = digits.startsWith("267") && digits.length === 11 ? digits.slice(3) : digits;
  // Botswana mobiles are eight digits and start with 7.
  return /^7\d{7}$/.test(national) ? `+267${national}` : null;
}

/** The addresses in a cell that may hold two, separated by a semicolon or a comma. */
export function emailsIn(raw: string): string[] {
  return (raw ?? "")
    .split(/[;,]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/** Whether an address is well enough formed to send to. */
export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(value);
}

/**
 * A full name split into the two columns an application has.
 *
 * The first word is what the child is called, and everything after it is kept
 * together. "Penelope Resego Mbaiwa" becomes "Penelope" and "Resego Mbaiwa",
 * so the letter's prose reads "Penelope will maintain…" while the heading
 * still reads the whole name. Putting the middle names with the surname is
 * imperfect for a school record and deliberately so: the registration form
 * collects the legal name properly later, exactly as it does the date of
 * birth, and guessing which of three words is the surname would be worse.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * The promotion code for an award cell.
 *
 * "Academic 50%", "Sports 30%" and "Cultural 20%" all map to the band, not to
 * the reason: the reason is why the school gave it, and the band is what it is
 * worth. Keeping the reason out of the code is what stops there being twelve
 * promotions where there are four.
 */
export function promotionCodeFor(award: string): string | null {
  const match = /(\d{1,3})\s*%/.exec(award ?? "");
  if (!match) return null;
  const percent = Number(match[1]);
  return percent > 0 && percent <= 100 ? `SCHOLARSHIP-${percent}` : null;
}

/** Whether a row of cells is the header rather than a family. */
function isHeader(cells: string[]): boolean {
  const lower = cells.map((c) => (c ?? "").trim().toLowerCase());
  return HEADERS.every((h) => lower.includes(h));
}

/**
 * Read every sheet of the secondary workbook.
 *
 * A row that cannot be sent to — no usable email, no usable mobile, no award —
 * becomes a problem rather than a record. Nothing is guessed: an address of
 * `fenterh@gmailcom` is a typo a person has to fix, and inventing the dot
 * would be worse than refusing the row.
 */
export function readRoster(sheets: Array<{ name: string; rows: string[][] }>): RosterResult {
  const rows: RosterRow[] = [];
  const problems: RosterProblem[] = [];

  for (const sheet of sheets) {
    for (const [index, cells] of sheet.rows.entries()) {
      const line = index + 1;
      if (isHeader(cells)) continue;
      // The first column is the school's own numbering. Everything to the
      // right of it is the record.
      const [, student = "", className = "", parent = "", emailCell = "", phoneCell = "", award = ""] = cells;
      if (!student.trim() && !parent.trim()) continue;

      const name = student.trim();
      const fail = (why: string) => problems.push({ sheet: sheet.name, line, student: name || "(no name)", why });
      const notes: string[] = [];

      if (!name) {
        fail("no applicant name");
        continue;
      }
      if (!className.trim()) {
        fail("no class");
        continue;
      }

      const promotionCode = promotionCodeFor(award);
      if (!promotionCode) {
        fail(`award "${award.trim() || "(blank)"}" does not name a percentage`);
        continue;
      }

      const addresses = emailsIn(emailCell);
      const usable = addresses.filter(looksLikeEmail);
      if (usable.length === 0) {
        fail(addresses.length ? `email "${addresses[0]}" is not a valid address` : "no email address");
        continue;
      }
      if (addresses.length > usable.length) notes.push(`ignored a malformed address: ${addresses.find((a) => !looksLikeEmail(a))}`);
      if (usable.length > 1) notes.push(`second address on file: ${usable.slice(1).join(", ")}`);

      const locals = mobilesIn(phoneCell);
      const mobiles = locals.map(toBotswanaE164).filter((m): m is string => m !== null);
      if (mobiles.length === 0) {
        fail(locals.length ? `"${phoneCell.trim()}" is not a Botswana mobile` : "no phone number");
        continue;
      }
      if (mobiles.length > 1) notes.push(`other numbers on file: ${mobiles.slice(1).join(", ")}`);

      const child = splitName(name);
      const guardian = splitName(parent);
      if (!guardian.first) {
        fail("no parent or guardian name");
        continue;
      }

      rows.push({
        sheet: sheet.name,
        line,
        studentFirstName: child.first,
        studentLastName: child.last,
        parentFirstName: guardian.first,
        parentLastName: guardian.last,
        email: usable[0],
        mobile: mobiles[0],
        className: className.trim(),
        promotionCode,
        notes,
      });
    }
  }

  return { rows, problems };
}
