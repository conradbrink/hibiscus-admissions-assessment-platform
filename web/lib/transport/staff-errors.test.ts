import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKnownBookingError } from "@/lib/transport/errors";
import { STAFF_REFUSALS, staffTransportError } from "@/lib/transport/staff-errors";

const MIGRATIONS = join(__dirname, "..", "..", "..", "supabase", "migrations");

/** Every code a transport migration raises, from the text of the migrations themselves. */
function raisedCodes(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => /^202610(1[6-9]|[23]\d)\d*_transport_.*\.sql$/.test(f));
  expect(files.length).toBeGreaterThanOrEqual(5);
  const codes = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(join(MIGRATIONS, f), "utf8").matchAll(/raise exception '([a-z_]+)'/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

describe("staffTransportError", () => {
  it("has a sentence, for staff or for the parent, for every code a transport migration raises", () => {
    const missing = raisedCodes().filter((c) => !(c in STAFF_REFUSALS) && !isKnownBookingError(c));
    expect(missing).toEqual([]);
  });

  it("finds the code inside PostgREST's message and leaves anything else as it came", () => {
    expect(staffTransportError("transport_refund_too_much")).toBe(STAFF_REFUSALS.transport_refund_too_much);
    expect(staffTransportError('new row violates check constraint "transport_periods_check"')).toBe(STAFF_REFUSALS.transport_periods_check);
    expect(staffTransportError("connection reset")).toBe("connection reset");
  });

  it("never shows a code: no sentence contains one", () => {
    for (const sentence of Object.values(STAFF_REFUSALS)) expect(sentence).not.toMatch(/[a-z]+_[a-z]+/);
  });
});
