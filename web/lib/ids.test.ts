import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Ids that came out of the database must not be re-validated against RFC 4122.
 *
 * Postgres's `uuid` type stores any 128 bits of hex. It does not care about the
 * version and variant nibbles the RFC reserves, and neither does a foreign key.
 * Zod v4's `z.uuid()` does care — it rejects anything whose 13th and 17th
 * hex digits are not a version 1-8 and a variant of 8, 9, a or b.
 *
 * Six fee schedules at Potch were created with hand-made ids that fail that
 * test. Every one of them made `/staff/admin/fees` refuse to save, before any
 * work happened, with "Some of what was entered is not valid" — because
 * `guarded()` turns a ZodError into exactly that sentence, and it names no
 * field. The row was fine, the form was fine, and nothing on the screen said
 * which of the two was being complained about.
 *
 * `z.guid()` is the shape check without the RFC arithmetic, which is what
 * every one of these fields actually wants: proof that a posted string is
 * id-shaped, with the column type and the foreign key doing the real work.
 */

const uuidLike = "aedc3cbe-c165-60b5-35a7-d86886a06cd9"; // a live fee_schedules.id
const properV4 = "4e1fadf9-d3fb-403c-ae6d-d5c32874a52d"; // also live, from gen_random_uuid()

describe("id validation", () => {
  it("accepts an id Postgres accepts, RFC nibbles or not", () => {
    expect(z.guid().safeParse(uuidLike).success).toBe(true);
    expect(z.guid().safeParse(properV4).success).toBe(true);
  });

  it("is the difference that broke the fees page", () => {
    // Pinning the behaviour rather than trusting the memory of it: if a zod
    // upgrade ever relaxes z.uuid(), this test says so instead of quietly
    // making the rule below pointless.
    expect(z.uuid().safeParse(uuidLike).success).toBe(false);
    expect(z.uuid().safeParse(properV4).success).toBe(true);
  });

  it("still refuses what is not an id", () => {
    for (const bad of ["", "not-an-id", "aedc3cbe", `${uuidLike} or 1=1`, `${uuidLike}x`]) {
      expect(z.guid().safeParse(bad).success).toBe(false);
    }
  });

  it("is not used anywhere in the app or the library", () => {
    // Every id these schemas parse is one the database handed out. Reach for
    // z.guid(); z.uuid() will reject a legitimate row and blame the form.
    const root = join(import.meta.dirname, "..");
    const files = execFileSync(
      "git",
      ["ls-files", "app", "lib", "components", "--", "*.ts", "*.tsx"],
      { cwd: root, encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean);

    // This file names z.uuid deliberately, in the two cases above that pin the
    // difference, so it cannot be held to its own rule. Do not remove the
    // exclusion: without it the guard fails on itself the moment it is
    // committed, which is exactly how it first reached CI red.
    const SELF = "lib/ids.test.ts";
    const offenders = files
      .filter((f) => f !== SELF)
      .filter((f) => readFileSync(join(root, f), "utf8").includes("z.uuid("));
    expect(offenders, `use z.guid() instead of z.uuid() in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
