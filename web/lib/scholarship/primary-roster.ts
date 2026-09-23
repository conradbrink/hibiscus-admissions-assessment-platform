import {
  emailsIn,
  looksLikeEmail,
  mobilesIn,
  splitName,
  toBotswanaE164,
  type RosterProblem,
  type RosterRow,
} from "@/lib/scholarship/roster";

/**
 * The primary-school scholarship spreadsheet, turned into rows we can act on.
 *
 * A separate reader from `roster.ts` because the file is a different shape,
 * not a variation on one. The secondary sheet is a list: one family per row,
 * the award in a column. The primary sheet is **five award blocks side by
 * side**, each with its own numbering starting again at 1:
 *
 *   | 50% Scholarship  …                        |   | 40% Scholarship  …        |   | (30%) …
 *   | Name & Surname | Stage | Academics/Sport | Current School | Parent Name | E-mail | Contact |
 *   | Aleo Berlin …  | 5.0   | 90% Academics   | Mafitlhakgosi… | Itumeleng … | g@…    | 71735987 / 72954280
 *
 * Two things about that layout are traps rather than inconveniences.
 *
 * **The award is the block, never the cell.** The column headed
 * "Academics/Sport" holds the *merit* — why the school gave the award — and it
 * is written as a percentage too: "90% Academics", "80% Academics & Sports".
 * Reading the band out of that column, as the secondary reader quite correctly
 * does with its AWARD column, would award `SCHOLARSHIP-90` to a child in the
 * 50% block and `SCHOLARSHIP-80` to one in the 40%. Nine of the twenty-six
 * importable families are in exactly that position. So the band comes from the
 * block header, and the merit column is never consulted for it.
 *
 * **Three of the five blocks have no contact columns at all.** The 30%, 20%
 * and 10% blocks carry a name, a stage and a phone number — no parent name,
 * no email. Those families cannot be written to and are not pretended about:
 * they come back as `pending`, counted and named, so a run reports "26
 * importable, 66 waiting on contact details" rather than silently reading 26
 * out of a file of 92.
 *
 * Nothing here touches the database. The whole awkward part — a phone number
 * a spreadsheet turned into `7.1812621E7`, a nine-digit number that is not a
 * Botswana mobile, a stage written as `5.0` — is testable against the real
 * file rather than discovered during an import.
 */

/** A family in a block with no contact columns yet. Named, so nobody is lost. */
export type PendingRow = {
  sheet: string;
  line: number;
  studentName: string;
  className: string;
  promotionCode: string;
  /** The one thing these blocks do carry, where it is a usable Botswana mobile. */
  mobile: string | null;
  why: string;
};

/** What a reader found in one award block, for a report somebody reconciles by eye. */
export type BlockSummary = {
  promotionCode: string;
  /** Whether the block has the columns needed to write to a family. */
  contactable: boolean;
  rows: number;
};

export type PrimaryRosterResult = {
  rows: RosterRow[];
  problems: RosterProblem[];
  pending: PendingRow[];
  blocks: BlockSummary[];
};

/** A header label with its punctuation and case thrown away: "E-mail" and "Email" are one label. */
function label(cell: string): string {
  return (cell ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const NAME = "namesurname";

/**
 * "5.0" is Stage 5, and so are "5" and "Stage 5".
 *
 * The cell is a float because the whole column is numeric, so the stage a
 * person typed as 5 reaches us as "5.0". Returned as the class name the
 * placement map is keyed by, or null when it is not a stage at all.
 */
export function classNameForStage(raw: string): string | null {
  const cell = (raw ?? "").trim();
  if (!cell) return null;
  const match = /^(?:stage\s*)?(\d{1,2})(?:\.0+)?$/i.exec(cell);
  if (!match) return null;
  const stage = Number(match[1]);
  return stage >= 1 && stage <= 9 ? `Stage ${stage}` : null;
}

/**
 * The award band a cell names, as a promotion code.
 *
 * Two spellings reach this, because the file writes the band twice in
 * different ways. The block headers say "50% Scholarship". The blocks with no
 * header carry it per row as a fraction — `0.3` — which is what a spreadsheet
 * leaves behind when somebody formats a column as a percentage.
 */
export function bandCodeIn(raw: string): string | null {
  const cell = (raw ?? "").trim();
  if (!cell) return null;

  const percent = /(\d{1,3})\s*%/.exec(cell);
  if (percent) {
    const value = Number(percent[1]);
    return value > 0 && value <= 100 ? `SCHOLARSHIP-${value}` : null;
  }

  // A bare fraction, and only a fraction: `0.3` is thirty per cent, while a
  // bare `30` is refused because in this file a small bare number is far more
  // likely to be a stage than a band.
  if (/^0?\.\d+$/.test(cell)) {
    const value = Number(cell);
    if (!Number.isFinite(value) || value <= 0 || value > 1) return null;
    const rounded = Math.round(value * 100);
    return rounded > 0 ? `SCHOLARSHIP-${rounded}` : null;
  }

  return null;
}

/**
 * Whether a cell is one of the school's own row numbers: 1.0, 2.0, 3.0 …
 *
 * This is what tells a family apart from everything else written on the same
 * line, and it has to be strict about being a whole number. The workbook's
 * summary table sits in columns 30 and 31 — which are *exactly* the numbering
 * and name columns of the 10% block — so `0.5 | 12.0` and `0.4 | 14.0` line up
 * as perfectly plausible families called "12.0" and "14.0". Requiring a whole
 * number is what stops the tally at the bottom of the sheet being imported as
 * five children.
 */
function isRowNumber(raw: string): boolean {
  const cell = (raw ?? "").trim();
  if (!/^\d+(\.0+)?$/.test(cell)) return false;
  const value = Number(cell);
  return Number.isInteger(value) && value > 0;
}

type Block = {
  /** First column of the block: the one headed "Name & Surname". */
  start: number;
  /** One past the last column of the block. */
  end: number;
  /** Column offsets from `start`, by header label, where the block has them. */
  stage: number | null;
  parent: number | null;
  email: number | null;
  contact: number | null;
  promotionCode: string | null;
};

/**
 * The award blocks in one sheet, found from the file rather than assumed.
 *
 * Column positions are not hard-coded: the blocks are wherever "Name &
 * Surname" appears in the header row, each running to the start of the next
 * one, and the columns inside are located by their own labels. That matters
 * because the remaining three bands arrive with contact details added, which
 * will move every column to the right of them.
 */
function blocksIn(header: string[], bandRow: string[]): Block[] {
  const starts = header.map((cell, i) => (label(cell) === NAME ? i : -1)).filter((i) => i >= 0);

  return starts.map((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : Math.max(header.length, bandRow.length);
    const at = (want: string): number | null => {
      for (let i = start; i < end; i++) if (label(header[i] ?? "") === want) return i - start;
      return null;
    };

    // The band header sits above the block, anywhere across its columns.
    let promotionCode: string | null = null;
    for (let i = start; i < end && !promotionCode; i++) promotionCode = bandCodeIn(bandRow[i] ?? "");

    return { start, end, stage: at("stage"), parent: at("parentname"), email: at("email"), contact: at("contact"), promotionCode };
  });
}

/**
 * The band a headerless block carries per row, but only if every row agrees.
 *
 * The 30/20/10 blocks name their band in a column of their own instead of in a
 * header. Taking the first value would be a guess; requiring the whole block
 * to agree makes a mixed column a refusal rather than a silent mis-award, and
 * a mis-awarded scholarship is a letter promising a family the wrong money.
 */
function bandFromRows(rows: string[][], block: Block): string | null {
  for (let column = block.start; column < block.end; column++) {
    const codes = rows.map((cells) => bandCodeIn(cells[column] ?? "")).filter((c): c is string => c !== null);
    if (codes.length === 0) continue;
    if (codes.length === rows.length && new Set(codes).size === 1) return codes[0];
  }
  return null;
}

/**
 * The Botswana mobile somewhere in a block that has no "Contact" header.
 *
 * The 30/20/10 blocks do carry a phone number, but in a column the school left
 * unlabelled — the header beside it reads "Academics / Sports" and the data
 * under *that* is the band. There is no label to look it up by, so it is
 * found by shape instead: `toBotswanaE164` takes only eight digits starting
 * with 7, which no stage (`6.0`) and no band (`0.3`) can be mistaken for.
 *
 * A heuristic, and confined to where one is harmless: these families are never
 * written to, and the number only rides along in the report so that whoever
 * chases their contact details tomorrow has something to ring.
 */
function mobileAnywhereIn(cells: string[], block: Block): string | null {
  for (let column = block.start; column < block.end; column++) {
    for (const local of mobilesIn(cells[column] ?? "")) {
      const mobile = toBotswanaE164(local);
      if (mobile) return mobile;
    }
  }
  return null;
}

/**
 * Read every award block of the primary workbook.
 *
 * A row in a contactable block that cannot be sent to — no usable email, no
 * usable mobile, no parent name — becomes a problem rather than a record, and
 * nothing is guessed. A row in a block with no contact columns becomes
 * `pending`: not a failure, just not yet.
 */
export function readPrimaryRoster(sheets: Array<{ name: string; rows: string[][] }>): PrimaryRosterResult {
  const rows: RosterRow[] = [];
  const problems: RosterProblem[] = [];
  const pending: PendingRow[] = [];
  const blocks: BlockSummary[] = [];

  for (const sheet of sheets) {
    const headerIndex = sheet.rows.findIndex((cells) => cells.some((cell) => label(cell) === NAME));
    if (headerIndex < 0) continue;

    const header = sheet.rows[headerIndex];
    const bandRow = headerIndex > 0 ? sheet.rows[headerIndex - 1] : [];
    const body = sheet.rows.slice(headerIndex + 1);

    for (const block of blocksIn(header, bandRow)) {
      // A row belongs to this block when the school numbered it there. Its own
      // numbering, one column to the left of the name, is the only thing that
      // separates a family from everything else written on the same line: the
      // notes down the side of the 50% block, the "Scholarship allocation 50%"
      // heading, and the summary table that occupies the 10% block's own two
      // columns. Names alone would read all of those as children.
      //
      // A block starting in the first column has no room for a numbering
      // column; then a name is all there is to go on.
      const numbered = block.start > 0;
      const mine = body
        .map((cells, index) => ({ cells, line: headerIndex + 2 + index }))
        .filter(({ cells }) => (cells[block.start] ?? "").trim().length > 0)
        .filter(({ cells }) => !numbered || isRowNumber(cells[block.start - 1] ?? ""));
      if (mine.length === 0) continue;

      const code = block.promotionCode ?? bandFromRows(mine.map((m) => m.cells), block);
      const contactable = block.email !== null && block.contact !== null;
      blocks.push({ promotionCode: code ?? "(no band)", contactable, rows: mine.length });

      for (const { cells, line } of mine) {
        const cell = (offset: number | null) => (offset === null ? "" : (cells[block.start + offset] ?? "").trim());
        const name = (cells[block.start] ?? "").trim();
        const fail = (why: string) => problems.push({ sheet: sheet.name, line, student: name, why });

        if (!code) {
          fail("the block names no award band, and the rows do not agree on one either");
          continue;
        }

        const className = classNameForStage(cell(block.stage));
        if (!className) {
          fail(`stage "${cell(block.stage) || "(blank)"}" is not a stage`);
          continue;
        }

        if (!contactable) {
          pending.push({
            sheet: sheet.name,
            line,
            studentName: name,
            className,
            promotionCode: code,
            mobile: mobileAnywhereIn(cells, block),
            why: "this block has no parent name or email column yet",
          });
          continue;
        }

        const locals = mobilesIn(cell(block.contact));
        const mobiles = locals.map(toBotswanaE164).filter((m): m is string => m !== null);

        const notes: string[] = [];

        const addresses = emailsIn(cell(block.email));
        const usable = addresses.filter(looksLikeEmail);
        if (usable.length === 0) {
          fail(addresses.length ? `email "${addresses[0]}" is not a valid address` : "no email address");
          continue;
        }
        if (addresses.length > usable.length) {
          notes.push(`ignored a malformed address: ${addresses.find((a) => !looksLikeEmail(a))}`);
        }
        if (usable.length > 1) notes.push(`second address on file: ${usable.slice(1).join(", ")}`);

        if (mobiles.length === 0) {
          fail(locals.length ? `"${cell(block.contact)}" is not a Botswana mobile` : "no phone number");
          continue;
        }
        if (mobiles.length > 1) notes.push(`other numbers on file: ${mobiles.slice(1).join(", ")}`);

        const guardian = splitName(cell(block.parent));
        if (!guardian.first) {
          fail("no parent or guardian name");
          continue;
        }

        const child = splitName(name);
        rows.push({
          sheet: sheet.name,
          line,
          studentFirstName: child.first,
          studentLastName: child.last,
          parentFirstName: guardian.first,
          parentLastName: guardian.last,
          email: usable[0],
          mobile: mobiles[0],
          className,
          promotionCode: code,
          notes,
        });
      }
    }
  }

  return { rows, problems, pending, blocks };
}
