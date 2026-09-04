import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Answers never leave the server", as a test.
 *
 * The delivery module and every file under the kiosk route must not name
 * the two tables that hold keys. This reads the source rather than
 * inspecting types because a type can be widened by accident and a table
 * name in a select string cannot hide.
 */

const FORBIDDEN = ["form_answer_keys", "question_answers", "rubric_snapshot"];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("kiosk delivery never touches an answer key", () => {
  const root = path.resolve(__dirname, "..", "..");
  const files = [path.join(root, "lib", "assessment", "delivery.ts")];
  const kioskDir = path.join(root, "app", "(kiosk)");
  try {
    if (statSync(kioskDir).isDirectory()) files.push(...walk(kioskDir));
  } catch {
    // The kiosk routes arrive in a later step; the delivery module is enough to check until then.
  }

  for (const file of files) {
    it(`${path.relative(root, file)} names no key table`, () => {
      const source = readFileSync(file, "utf8");
      for (const word of FORBIDDEN) {
        // The comment in delivery.ts that states the rule mentions the names;
        // strip comments before looking.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        expect(code.includes(word), `${word} in ${file}`).toBe(false);
      }
    });
  }
});
