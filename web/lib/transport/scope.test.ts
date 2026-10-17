import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "A transport page reads through the loaders", as a test — the rule
 * `lib/family/scope.test.ts` keeps for the family pages.
 *
 * The person on these pages filled in an anonymous form, and there is no RLS
 * behind them, so the only thing between one household's booking and another's
 * is that every query names the booking from the verified cookie.
 * `lib/transport/scope.ts` is the one place allowed to name these tables.
 */

const FORBIDDEN = [
  '.from("transport_bookings"',
  '.from("transport_booking_riders"',
  '.from("payment_requests"',
  '.from("payments"',
  '.from("email_messages"',
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

describe("transport pages read through the scoped loaders", () => {
  const root = path.resolve(__dirname, "..", "..");
  const files = walk(path.join(root, "app", "(transport)"));

  it("has transport routes to check", () => {
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

  it("never hands the browser the provider's own prices", () => {
    // The booking form is a client component: what the page passes it is
    // published to every visitor. Only the parent's prices may cross.
    const book = readFileSync(path.join(root, "app", "(transport)", "transport", "book", "page.tsx"), "utf8");
    expect(book).toContain("customerTariffs(");
    const form = readFileSync(path.join(root, "components", "parent", "transport-booking-form.tsx"), "utf8");
    expect(form).not.toMatch(/provider_list_term_minor|rebate_bp|vat_bp/);
  });
});
