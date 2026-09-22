import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { readWorkbook } from "@/lib/xlsx-read";
import { readRoster } from "@/lib/scholarship/roster";
import { importScholarshipRoster, placementFor } from "@/lib/scholarship/import";

/**
 * The scholarship import, run by hand.
 *
 *   cd web
 *   SCHOLARSHIP_FILE=/path/to/highschool_scholarships_Block_7.xlsx \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * That is the dry run, and it needs no credentials at all. To write, add the
 * service role key and the commit flag:
 *
 *   SCHOLARSHIP_FILE=… SCHOLARSHIP_COMMIT=1 SCHOLARSHIP_LIMIT=1 \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * `SCHOLARSHIP_LIMIT=1` does one family, which is how the first eighty should
 * start. `NEXT_PUBLIC_SUPABASE_URL` is the name `createAdminClient` reads, odd
 * as it looks beside a service role key.
 *
 * It is a test file because vitest is the only thing in this repository that
 * resolves the `@/` aliases the libraries import by — plain node cannot load
 * TypeScript with path aliases. Everything with a decision in it is in the
 * modules beside this one, with their own tests; this file only reads the
 * environment and prints.
 *
 * **It does nothing at all unless `SCHOLARSHIP_FILE` is set.** It has its own
 * config, so `npm test` never collects it — but the environment guard is the
 * one that matters: a guard that depends on a glob is not a guard, and nobody
 * widening an include pattern should thereby import eighty families into
 * production.
 */

const file = process.env.SCHOLARSHIP_FILE;
const commit = process.env.SCHOLARSHIP_COMMIT === "1";
const limit = Number(process.env.SCHOLARSHIP_LIMIT ?? Infinity);
const only = process.env.SCHOLARSHIP_ONLY?.toLowerCase() ?? null;

// Which class sits where. Not in the spreadsheet — a placement decision.
const PLACEMENT = [
  { className: "Form 1", campusName: "Block 7" },
  { className: "Form 2", campusName: "Block 7" },
  { className: "Form 3", campusName: "Block 7" },
  { className: "Form 4", campusName: "Block 7" },
  { className: "Form 5", campusName: "Block 7" },
  { className: "Stage 4", campusName: "Broadhurst" },
  { className: "Stage 5", campusName: "Broadhurst" },
  { className: "Stage 6", campusName: "Broadhurst" },
  { className: "Stage 7", campusName: "Broadhurst" },
];

/** Until the family gives the real one on the registration form. */
const PLACEHOLDER_DOB = "2010-01-01";

describe.skipIf(!file)("scholarship import", () => {
  it("imports the roster", { timeout: 600_000 }, async () => {
    const sheets = readWorkbook(readFileSync(file as string));
    const { rows, problems } = readRoster(sheets);

    let wanted = rows;
    if (only) wanted = wanted.filter((r) => r.email.toLowerCase() === only);
    if (Number.isFinite(limit)) wanted = wanted.slice(0, limit);

    // A dry run reads a file and reports. It must not need a service-role key
    // to do that — needing credentials to find out what *would* happen is how
    // people skip the dry run and go straight to the real one.
    if (!commit) {
      console.log(`\nDRY RUN — nothing written, no database touched`);
      console.log(`read ${rows.length}, would attempt ${wanted.length}`);
      tallies(wanted);
      report(problems, [], wanted);
      expect(wanted.every((r) => PLACEMENT.some((p) => p.className === r.className)), "a class has no campus mapped").toBe(true);
      return;
    }

    const admin = createAdminClient();
    const intake = await admin
      .from("intakes")
      .select("id, label")
      .eq("label", process.env.SCHOLARSHIP_INTAKE ?? "Term 1, 2027")
      .maybeSingle();
    expect(intake.data?.id, "intake not found").toBeTruthy();

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
    tallies(wanted);
    report(problems, outcome.rows, wanted);
    for (const r of outcome.rows) {
      const ref = "reference" in r.outcome ? r.outcome.reference : "—";
      console.log(`  ${r.outcome.status.padEnd(8)} ${ref.padEnd(16)} ${r.className.padEnd(7)} ${r.promotionCode.padEnd(15)} ${r.studentFirstName} ${r.studentLastName}`);
    }
    expect(outcome.refused, "some rows were refused by the database").toBe(0);
  });
});

/**
 * The two counts a person reconciles against the school's own figures.
 *
 * The awards matter as much as the classes. A band this intake never created —
 * `SCHOLARSHIP-35` from a mistyped cell — is refused by the database when the
 * run commits, but the dry run deliberately needs no credentials and so never
 * reaches that check. Printing the tally is what makes the typo visible before
 * anybody spends a service role key on it, and reconciling both lists is the
 * step the plan asks for anyway.
 */
function tallies(rows: Array<{ className: string; promotionCode: string }>): void {
  const count = <T,>(items: T[], key: (t: T) => string) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
    return [...m].sort();
  };
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
  rows: Array<{ studentFirstName: string; studentLastName: string; notes: string[]; outcome: { status: string; why?: string } }>,
  wanted: Array<{ notes: string[]; studentFirstName: string; studentLastName: string }>
): void {
  if (problems.length) {
    console.log(`\nrefused before the database (${problems.length}) — these need a person:`);
    for (const p of problems) console.log(`  ${p.sheet}:${p.line} ${p.student} — ${p.why}`);
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
