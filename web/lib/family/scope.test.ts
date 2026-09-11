import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "A family page reads through the loaders", as a test.
 *
 * There is no RLS behind a parent session, so the only thing standing between
 * one family and another is that every query names the family from the
 * verified cookie. A missed `.eq("family_id", …)` in a page would leak
 * somebody else's children — their medical facts and their documents with
 * them.
 *
 * `lib/family/scope.ts` is the one place allowed to name these tables. This
 * reads the source of every family route rather than inspecting types,
 * because a table name in a select string cannot hide, and follows the same
 * shape as `lib/assessment/delivery.test.ts`, which keeps answer keys off the
 * kiosk the same way.
 */

const FORBIDDEN = [
  '.from("students"',
  '.from("enrolments"',
  '.from("families"',
  '.from("contacts"',
  '.from("documents"',
  '.from("registrations"',
  '.from("applications"',
  '.from("reenrolment_responses"',
  '.from("reenrolment_cycles"',
  '.from("onboarding_steps"',
  '.from("student_onboarding_items"',
  '.from("optional_items"',
  '.from("student_optional_selections"',
  // The service-role client is minted by the loaders, so a page that builds
  // its own is a page that could query anything.
  "createAdminClient",
];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("family pages read through the scoped loaders", () => {
  const root = path.resolve(__dirname, "..", "..");
  const familyDir = path.join(root, "app", "(parent)", "family");

  let files: string[] = [];
  try {
    if (statSync(familyDir).isDirectory()) files = walk(familyDir);
  } catch {
    // The family routes arrive with the hub; until then there is nothing to
    // check and the loaders are the only caller.
  }

  it("has family routes to check", () => {
    // A rename that moved the directory would otherwise turn this whole file
    // into a silent pass.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${path.relative(root, file)} queries nothing directly`, () => {
      const source = readFileSync(file, "utf8");
      for (const word of FORBIDDEN) {
        expect(source.includes(word), `${path.relative(root, file)} names ${word}`).toBe(false);
      }
    });
  }
});
