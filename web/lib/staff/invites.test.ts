import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source-level check, because the failure lives in the wire shape rather
 * than in any function's return value: PostgREST answers an ambiguous embed
 * with HTTP 300 and an empty body, and the client reports "no rows", which
 * the page then renders as "this link is not recognised". `staff_invites`
 * carries two foreign keys to `staff_profiles`, so its embed must name one.
 */
describe("the invitation lookup names which staff_profiles it joins", () => {
  it("qualifies the embed with the staff_id foreign key", () => {
    const source = readFileSync(path.join(__dirname, "invites.ts"), "utf8");
    const selects = source.split("\n").filter((line) => line.includes(".select("));
    expect(selects.some((line) => line.includes("staff_profiles!staff_invites_staff_id_fkey("))).toBe(true);
    for (const line of selects) expect(line).not.toMatch(/[^!]staff_profiles\(/);
  });
});
