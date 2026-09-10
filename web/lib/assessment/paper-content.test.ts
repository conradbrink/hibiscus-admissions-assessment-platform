import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Cambridge paper content under web/content/papers is data the seed
 * turns into questions. A malformed item would surface on assessment day,
 * so the files are checked here the way the seed checks them.
 */

const dir = path.resolve(__dirname, "..", "..", "content", "papers");
const files = readdirSync(dir).filter((f) => /^s\d-[a-z]+\.json$/.test(f));

const TYPES = ["single_choice", "multi_select", "numeric", "short_text", "matching", "ordering", "extended_text"];
const COMPETENCIES = new Set([
  "reading", "comprehension", "vocabulary", "grammar", "written_language",
  "number_sense", "arithmetic", "geometry", "measures_data", "patterns", "problem_solving",
  "science_biology", "science_chemistry", "science_physics", "science_enquiry",
]);

type Item = {
  code: string; competency: string; type: string; stem: string; marks: number; difficulty: number;
  media?: string; passage?: string; options?: string[]; pairs?: [string, string][]; key?: Record<string, unknown>;
};
type Paper = { code: string; subject: string; stage: number; time_limit_minutes: number; passages?: { key: string }[]; sections: { title: string; items: Item[] }[] };

describe("Cambridge paper content", () => {
  it("has the twelve papers", () => {
    expect(files.sort()).toEqual([
      "s3-english.json", "s3-mathematics.json", "s3-science.json",
      "s4-english.json", "s4-mathematics.json", "s4-science.json",
      "s5-english.json", "s5-mathematics.json", "s5-science.json",
      "s6-english.json", "s6-mathematics.json", "s6-science.json",
    ]);
  });

  it("covers every entry stage from Stage 4 to Stage 7", () => {
    // Each paper is sat by the stage above it, so Stage 3 to Stage 6 as
    // papers is Stage 4 to Stage 7 as entry bands, with no gap in between.
    const stages = new Set(files.map((f) => Number(f[1])));
    expect([...stages].sort()).toEqual([3, 4, 5, 6]);
  });

  for (const file of files) {
    it(`${file} is well formed`, () => {
      const paper = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Paper;
      expect(paper.code).toBe(file.replace(".json", ""));
      expect(["english", "mathematics", "science"]).toContain(paper.subject);
      expect(paper.time_limit_minutes).toBe(40);
      const codes = new Set<string>();
      const passageKeys = new Set((paper.passages ?? []).map((p) => p.key));
      for (const section of paper.sections) {
        expect(section.items.length).toBeGreaterThan(0);
        for (const it of section.items) {
          expect(it.code, "code").toMatch(/^S\d-(EN|MA|SC)-Q\d+[a-z]*(i{1,3}v?|iv|v)?$/);
          expect(codes.has(it.code), `duplicate ${it.code}`).toBe(false);
          codes.add(it.code);
          expect(COMPETENCIES.has(it.competency), `${it.code} competency ${it.competency}`).toBe(true);
          expect(TYPES, `${it.code} type`).toContain(it.type);
          expect(it.stem.trim().length, `${it.code} stem`).toBeGreaterThan(0);
          expect(it.marks, `${it.code} marks`).toBeGreaterThan(0);
          expect(it.difficulty, `${it.code} difficulty`).toBeGreaterThanOrEqual(1);
          expect(it.difficulty).toBeLessThanOrEqual(5);
          if (it.media) expect(existsSync(path.join(dir, "media", it.media)), `${it.code} media ${it.media}`).toBe(true);
          if (it.passage) expect(passageKeys.has(it.passage), `${it.code} passage`).toBe(true);
          switch (it.type) {
            case "single_choice":
              expect(it.options?.length ?? 0).toBeGreaterThanOrEqual(2);
              expect(it.options, `${it.code} correct option`).toContain(it.key?.correct);
              break;
            case "multi_select": {
              const correct = it.key?.correct as string[];
              expect(correct.length).toBeGreaterThanOrEqual(1);
              for (const c of correct) expect(it.options, `${it.code} correct ${c}`).toContain(c);
              break;
            }
            case "numeric":
              expect(typeof it.key?.value, `${it.code} value`).toBe("number");
              break;
            case "short_text":
              expect((it.key?.accepted as string[]).length, `${it.code} accepted`).toBeGreaterThanOrEqual(1);
              break;
            case "matching":
              expect(it.pairs?.length ?? 0, `${it.code} pairs`).toBeGreaterThanOrEqual(1);
              break;
            case "ordering":
              expect(it.options?.length ?? 0, `${it.code} options`).toBeGreaterThanOrEqual(2);
              break;
            case "extended_text":
              expect(it.competency).toBe("written_language");
              break;
          }
        }
      }
    });
  }
});
