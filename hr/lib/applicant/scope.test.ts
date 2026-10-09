import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Applicants and referees have no RLS behind them, so a page that queries a
 * table itself is one missing `.eq()` from showing someone else's
 * application. These tests fail the build if any applicant or referee route
 * queries the database directly, or if the applicant view gains a field for
 * anything an applicant must not see.
 */

const ROOT = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const PUBLIC_ROUTES = ["app/(applicant)", "app/(referee)", "app/h", "app/r", "components/applicant", "components/referee"].flatMap((d) =>
  files(path.join(ROOT, d))
);

describe("applicant and referee routes", () => {
  it("never query a table or call an RPC themselves", () => {
    const offenders = PUBLIC_ROUTES.filter((f) => /\.(from|rpc)\(\s*["'`]/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("never read an id from the query string", () => {
    const offenders = PUBLIC_ROUTES.filter((f) => /searchParams[^;]*\b(application|reference|request)_?id\b/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("what an applicant can be shown", () => {
  const scope = readFileSync(path.join(ROOT, "lib/applicant/scope.ts"), "utf8");

  it("selects no rubric, band, rationale, likelihood or score", () => {
    const columns = new Set([...scope.matchAll(/\.select\(\s*"([^"]*)"/g)].flatMap((m) => m[1].split(/[\s,]+/)));
    for (const banned of ["rubric", "ai_band", "human_band", "ai_rationale", "ai_likelihood", "score_total", "score_flags", "integrity", "stage", "communication_ai_band"]) {
      expect(columns.has(banned), banned).toBe(false);
    }
  });

  it("never reads references or notes", () => {
    for (const table of ["hr_reference_responses", "hr_application_notes", "hr_application_scores", "hr_audit_log"]) {
      expect(scope).not.toContain(table);
    }
  });
});

describe("the AI seam", () => {
  it("is the only place the vendor SDK is imported", () => {
    const all = ["app", "lib", "components"].flatMap((d) => files(path.join(ROOT, d)));
    const offenders = all.filter((f) => !f.includes(`${path.sep}lib${path.sep}ai${path.sep}anthropic.ts`) && /@anthropic-ai\/sdk/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

describe("the stage", () => {
  it("is written only by the engine", () => {
    const all = ["app", "lib", "components"].flatMap((d) => files(path.join(ROOT, d)));
    const offenders = all.filter((f) => !f.endsWith(`recruitment${path.sep}engine.ts`) && /stage:\s*["']/.test(readFileSync(f, "utf8")) && /\.update\(/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
