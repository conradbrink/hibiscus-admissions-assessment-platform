import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { readWorkbook } from "@/lib/xlsx-read";
import { readPrimaryRoster } from "@/lib/scholarship/primary-roster";
import { looksLikeSameChild } from "@/lib/scholarship/near-name";
import { importScholarshipRoster, placementFor } from "@/lib/scholarship/import";

/**
 * The primary-school scholarship import, run by hand.
 *
 *   cd web
 *   PRIMARY_SCHOLARSHIP_FILE=/path/to/primary_scholarships_1.xlsx \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * That is the dry run. To write, add the service role key and the commit flag:
 *
 *   PRIMARY_SCHOLARSHIP_FILE=… PRIMARY_SCHOLARSHIP_COMMIT=1 PRIMARY_SCHOLARSHIP_LIMIT=1 \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * A sibling of `scholarship-run.test.ts` rather than a flag on it, because the
 * two workbooks are different shapes and the reader is what differs — see
 * `lib/scholarship/primary-roster.ts`. Everything after the reader is shared:
 * the same `importScholarshipRoster`, the same placement lookup, the same
 * four-step order per child.
 *
 * **It does nothing at all unless `PRIMARY_SCHOLARSHIP_FILE` is set.** It has
 * its own config, so `npm test` never collects it — but the environment guard
 * is the one that matters: a guard that depends on a glob is not a guard.
 */

const file = process.env.PRIMARY_SCHOLARSHIP_FILE;
const commit = process.env.PRIMARY_SCHOLARSHIP_COMMIT === "1";
const limit = Number(process.env.PRIMARY_SCHOLARSHIP_LIMIT ?? Infinity);
const only = process.env.PRIMARY_SCHOLARSHIP_ONLY?.toLowerCase() ?? null;

/**
 * Which class sits where. Not in the spreadsheet — a placement decision.
 *
 * Every child in this workbook is a primary stage and goes to Broadhurst,
 * which the school said when it sent the file. Listed rather than defaulted so
 * that a stage nobody planned for fails loudly instead of quietly placing a
 * child at whatever campus came first.
 */
const PLACEMENT = [
  { className: "Stage 4", campusName: "Broadhurst" },
  { className: "Stage 5", campusName: "Broadhurst" },
  { className: "Stage 6", campusName: "Broadhurst" },
  { className: "Stage 7", campusName: "Broadhurst" },
];

/** Until the family gives the real one on the registration form. */
const PLACEHOLDER_DOB = "2010-01-01";

/**
 * Corrections a person checked and confirmed, applied to the sheet before it
 * is read.
 *
 * Each entry names the wrong value as well as the right one, so a correction
 * can only ever replace the exact cell it was written for. And each names who
 * confirmed it, because in a year nobody will remember whether the address
 * came from the school or from somebody's guess.
 *
 * `masilodkgomo@gmaill.com` is the dangerous kind: it is a perfectly
 * well-formed address, so no parser would refuse it, and the letter would have
 * gone to a domain that does not exist while the run reported success. Only a
 * person reading the list could catch it — which is what happened.
 */
const CORRECTIONS: Array<{ student: string; was: string; email: string; why: string }> = [
  {
    student: "Ranewa Moana Kgomo",
    was: "masilodkgomo@gmaill.com",
    email: "masilodkgomo@gmail.com",
    why: "sheet reads gmaill.com with two Ls; one L confirmed by Conrad, 23 Sep 2026",
  },
];

/**
 * Apply the confirmed corrections, and say out loud which ones were used.
 *
 * A correction that matches nothing is reported rather than ignored: it means
 * the name or the old address was mistyped here, or the spreadsheet has been
 * replaced with one that no longer contains that child — and silently doing
 * nothing would leave a family unreachable with a line of code claiming
 * otherwise.
 *
 * Applied to the raw cells, not to the parsed rows, so a corrected row is then
 * validated exactly like every other one: a correction that is itself
 * malformed is still refused.
 */
function correct(sheets: Array<{ name: string; rows: string[][] }>): Array<{ name: string; rows: string[][] }> {
  const used = new Set<string>();

  const out = sheets.map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows.map((cells) => {
      // The blocks sit side by side, so a correction cannot be applied by
      // column number: find the row holding the child's name, then replace the
      // exact cell holding the exact wrong address.
      const fix = CORRECTIONS.find(
        (c) => cells.some((cell) => (cell ?? "").trim() === c.student) && cells.some((cell) => (cell ?? "").trim() === c.was)
      );
      if (!fix) return cells;
      used.add(fix.student);
      return cells.map((cell) => ((cell ?? "").trim() === fix.was ? fix.email : cell));
    }),
  }));

  for (const c of CORRECTIONS) {
    console.log(
      used.has(c.student)
        ? `  applied: ${c.student} — ${c.why}`
        : `  NOT MATCHED: ${c.student} (${c.was}) — is the name right, or has the file changed?`
    );
  }
  return out;
}

describe.skipIf(!file)("primary scholarship import", () => {
  it("imports the roster", { timeout: 600_000 }, async () => {
    const sheets = readWorkbook(readFileSync(file as string));
    const { rows, problems, pending, blocks } = readPrimaryRoster(correct(sheets));

    let wanted = rows;
    if (only) wanted = wanted.filter((r) => r.email.toLowerCase() === only);
    if (Number.isFinite(limit)) wanted = wanted.slice(0, limit);

    if (!commit) {
      console.log(`\nDRY RUN — nothing written`);
      console.log(`read ${rows.length}, would attempt ${wanted.length}`);
      blockSummary(blocks, rows, pending, problems);
      tallies(wanted);
      // The one check that needs the database. It only ever reads, so it runs
      // in the dry run too when the credentials happen to be there — that is
      // the moment it is useful, before anybody commits.
      await familiesAlreadyOnFile(wanted);
      report(problems, pending, [], wanted);
      expect(
        wanted.every((r) => PLACEMENT.some((p) => p.className === r.className)),
        "a class has no campus mapped"
      ).toBe(true);
      return;
    }

    const admin = createAdminClient();
    const intake = await admin
      .from("intakes")
      .select("id, label")
      .eq("label", process.env.PRIMARY_SCHOLARSHIP_INTAKE ?? "Term 1, 2027")
      .maybeSingle();
    expect(intake.data?.id, "intake not found").toBeTruthy();

    await familiesAlreadyOnFile(wanted);

    const placement = await placementFor(admin, PLACEMENT);
    const missing = [...new Set(wanted.map((r) => r.className))].filter((c) => !placement.has(c));
    expect(missing, `no grade or campus for ${missing.join(", ")}`).toEqual([]);

    const outcome = await importScholarshipRoster(admin, wanted, {
      placement,
      intakeId: intake.data!.id,
      placeholderDateOfBirth: PLACEHOLDER_DOB,
      dryRun: false,
    });

    console.log(`\nCOMMITTED`);
    console.log(`read ${rows.length}, attempted ${wanted.length}`);
    console.log(`created ${outcome.created} · already there ${outcome.existing} · refused ${outcome.refused}`);
    blockSummary(blocks, rows, pending, problems);
    tallies(wanted);
    report(problems, pending, outcome.rows, wanted);
    for (const r of outcome.rows) {
      const ref = "reference" in r.outcome ? r.outcome.reference : "—";
      console.log(
        `  ${r.outcome.status.padEnd(8)} ${ref.padEnd(16)} ${r.className.padEnd(8)} ${r.promotionCode.padEnd(15)} ${r.studentFirstName} ${r.studentLastName}`
      );
    }
    expect(outcome.refused, "some rows were refused by the database").toBe(0);
  });
});

/**
 * Near-name pairs a person has looked at and settled.
 *
 * The check below cannot tell two children from one child typed twice, and
 * neither can the index. Once somebody has decided, the decision belongs here
 * rather than in a memory: a second run should not raise the same alarm and
 * invite somebody to settle it differently.
 */
const CONFIRMED_DIFFERENT_CHILDREN: Array<{ importing: string; onFile: string; why: string }> = [
  {
    importing: "Lerang",
    onFile: "Letang",
    why: "siblings — Letang is Form 1 at Block 7, Lerang is Stage 6 at Broadhurst; confirmed by Conrad, 23 Sep 2026",
  },
];

/**
 * Families in this roster who are already in the system, and — the point of it
 * — children whose names are one letter away from a child already on file.
 *
 * Three of the twenty-six primary families already have a secondary child at
 * Block 7, which is ordinary: siblings. One of them is not ordinary. The
 * system holds **Letang** Aki Chilume; the scholarship sheet says **Lerang**
 * Chilume. If those are two children then both belong here, and if they are
 * one child then importing the second creates precisely the duplicate the
 * one-live-application-per-child index was built to prevent — and slips past
 * it, because the index matches on the name and a typo is a different name.
 *
 * Read-only, and it decides nothing. It prints, so a person looks before
 * twenty-six letters go out.
 */
async function familiesAlreadyOnFile(
  wanted: Array<{ email: string; studentFirstName: string; studentLastName: string; className: string }>
): Promise<void> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    console.log(`\nskipped the check against families already on file — no credentials in the environment.`);
    console.log(`  run this again with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before committing.`);
    return;
  }

  const emails = [...new Set(wanted.map((r) => r.email.trim().toLowerCase()))];

  // Two queries rather than an embed: `contacts` reaches `applications` both
  // directly and through `application_guardians`, so asking for the nested
  // rows is ambiguous and PostgREST refuses it. The direct one is the one that
  // matters — `create_application` keys on `contact_id`.
  const { data: contacts, error: contactError } = await admin
    .from("contacts")
    .select("id, email_normalised")
    .in("email_normalised", emails);
  if (contactError) throw new Error(contactError.message);

  const emailById = new Map((contacts ?? []).map((c) => [c.id as string, String(c.email_normalised).toLowerCase()]));
  const known = new Map<string, Array<{ reference: string; first: string; last: string; status: string; grade: string; campus: string }>>();

  if (emailById.size > 0) {
    const { data: apps, error: appError } = await admin
      .from("applications")
      // The foreign key is named because `applications` reaches `grades` twice,
      // through `grade_id` and `recommended_grade_id`. The grade the child is
      // actually in is the first.
      .select("contact_id, reference, child_first_name, child_last_name, status, grades!applications_grade_id_fkey(name), campuses(name)")
      .in("contact_id", [...emailById.keys()]);
    if (appError) throw new Error(appError.message);

    const one = <T,>(value: T | T[] | null | undefined): T | undefined => (Array.isArray(value) ? value[0] : value ?? undefined);
    for (const a of apps ?? []) {
      const email = emailById.get(a.contact_id as string);
      if (!email) continue;
      const list = known.get(email) ?? [];
      list.push({
        reference: String(a.reference ?? ""),
        first: String(a.child_first_name ?? ""),
        last: String(a.child_last_name ?? ""),
        status: String(a.status ?? ""),
        grade: String(one(a.grades as { name?: string } | { name?: string }[])?.name ?? "?"),
        campus: String(one(a.campuses as { name?: string } | { name?: string }[])?.name ?? "?"),
      });
      known.set(email, list);
    }
  }

  const seen = wanted.filter((r) => (known.get(r.email.trim().toLowerCase()) ?? []).length > 0);
  if (seen.length === 0) {
    console.log(`\nno family in this roster is already on file.`);
    return;
  }

  console.log(`\nfamilies already on file (${seen.length}) — the import joins the contact they already have:`);
  const suspect: string[] = [];
  for (const r of seen) {
    console.log(`  ${r.email}`);
    console.log(`    importing: ${r.studentFirstName} ${r.studentLastName} (${r.className})`);
    for (const a of known.get(r.email.trim().toLowerCase()) ?? []) {
      const near = looksLikeSameChild(a.first, r.studentFirstName);
      const settled = CONFIRMED_DIFFERENT_CHILDREN.find(
        (c) => c.importing.toLowerCase() === r.studentFirstName.trim().toLowerCase() && c.onFile.toLowerCase() === a.first.trim().toLowerCase()
      );
      const flag = !near ? "" : settled ? "   ← near name, settled" : "   ←← ONE LETTER APART";
      console.log(`    on file:   ${a.first} ${a.last} — ${a.reference} ${a.grade} ${a.campus} ${a.status}${flag}`);
      if (near && settled) console.log(`               ${settled.why}`);
      if (near && !settled) {
        suspect.push(`${r.studentFirstName} ${r.studentLastName} (importing) vs ${a.first} ${a.last} (${a.reference})`);
      }
    }
  }

  if (suspect.length) {
    console.log(`\n  STOP AND CHECK (${suspect.length}) — same parent, names one letter apart:`);
    for (const s of suspect) console.log(`    ${s}`);
    console.log(`  Two children, or one child typed twice? The index cannot tell, and neither can this.`);
  }
}

/**
 * What the file holds, band by band, reconciled against the school's own
 * figures before anything is written.
 *
 * The workbook's own summary says 92 applications across five bands. A run
 * that reads 26 of them is correct today and alarming if nobody says why, so
 * every block is listed whether or not it can be imported, and the arithmetic
 * is printed: read + waiting + refused should come to what the block holds.
 */
function blockSummary(
  blocks: Array<{ promotionCode: string; contactable: boolean; rows: number }>,
  rows: Array<{ promotionCode: string }>,
  pending: Array<{ promotionCode: string }>,
  problems: unknown[]
): void {
  console.log(`\nthe file, band by band:`);
  let total = 0;
  for (const b of blocks) {
    const read = rows.filter((r) => r.promotionCode === b.promotionCode).length;
    const waiting = pending.filter((p) => p.promotionCode === b.promotionCode).length;
    const note = b.contactable ? `${read} readable` : `${waiting} waiting on contact details`;
    console.log(`  ${b.promotionCode.padEnd(15)} ${String(b.rows).padStart(3)} in the block — ${note}`);
    total += b.rows;
  }
  console.log(`  ${"".padEnd(15)} ${String(total).padStart(3)} families in the file`);
  console.log(`  → ${rows.length} importable, ${pending.length} waiting on contact details, ${problems.length} needing a person`);
}

/** The two counts a person reconciles against the school's own figures. */
function tallies(rows: Array<{ className: string; promotionCode: string }>): void {
  const count = <T,>(items: T[], key: (t: T) => string) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
    return [...m].sort();
  };
  console.log("");
  for (const [className, n] of count(rows, (r) => r.className)) {
    const campus = PLACEMENT.find((p) => p.className === className)?.campusName ?? "NO CAMPUS MAPPED";
    console.log(`  ${String(n).padStart(3)} × ${className.padEnd(8)} → ${campus}`);
  }
  console.log("");
  for (const [code, n] of count(rows, (r) => r.promotionCode)) {
    console.log(`  ${String(n).padStart(3)} × ${code}`);
  }
}

/** What a person has to look at afterwards, whether or not anything was written. */
function report(
  problems: Array<{ sheet: string; line: number; student: string; why: string }>,
  pending: Array<{ studentName: string; className: string; promotionCode: string; mobile: string | null }>,
  rows: Array<{ studentFirstName: string; studentLastName: string; notes: string[]; outcome: { status: string; why?: string } }>,
  wanted: Array<{ notes: string[]; studentFirstName: string; studentLastName: string }>
): void {
  if (problems.length) {
    console.log(`\nrefused before the database (${problems.length}) — these need a person:`);
    for (const p of problems) console.log(`  ${p.sheet}:${p.line} ${p.student} — ${p.why}`);
  }
  if (pending.length) {
    console.log(`\nwaiting on contact details (${pending.length}) — nothing wrong with these, the columns are simply not filled in yet:`);
    for (const p of pending) {
      console.log(`  ${p.promotionCode.padEnd(15)} ${p.className.padEnd(8)} ${p.studentName}${p.mobile ? `  (${p.mobile})` : "  (no number either)"}`);
    }
  }
  const failed = rows.filter((r) => r.outcome.status === "refused");
  if (failed.length) {
    console.log(`\nrefused by the database (${failed.length}):`);
    for (const r of failed) console.log(`  ${r.studentFirstName} ${r.studentLastName} — ${r.outcome.why ?? ""}`);
  }
  const noted = (rows.length ? rows : wanted).filter((r) => r.notes.length);
  if (noted.length) {
    console.log(`\nchoices made, for the record (${noted.length}):`);
    for (const r of noted) console.log(`  ${r.studentFirstName} ${r.studentLastName} — ${r.notes.join("; ")}`);
  }
  console.log("");
}
