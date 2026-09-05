import { bandFor, type BenchmarkBands } from "@/lib/assessment/bands";
import type { BenchmarkBand, BenchmarkScope } from "@/lib/supabase/types";

/**
 * Turns marked items into scores: per competency, per subject, overall.
 *
 * Pure. Everything numeric the learning profile and the rules engine read
 * is computed here and nowhere else — the AI narrative receives these
 * numbers and may not produce any of its own.
 *
 * An unanswered or wrong item scores zero of its marks. An item that is
 * still waiting for a rubric mark counts its marks in `max` and nothing in
 * `raw`, and sets `complete` false, so a provisional overall is visible but
 * clearly provisional.
 */

export type ScoredItem = {
  competencyId: string;
  subjectId: string;
  marks: number;
  /** Null while a rubric mark is outstanding. */
  marksAwarded: number | null;
};

export type ScoreLine = {
  scope: BenchmarkScope;
  scopeId: string | null;
  raw: number;
  max: number;
  percent: number;
  band: BenchmarkBand;
};

export type BenchmarkRule = {
  scope: BenchmarkScope;
  scopeId: string | null;
  gradeSortMin: number | null;
  gradeSortMax: number | null;
  bands: BenchmarkBands;
};

export type Scores = { lines: ScoreLine[]; complete: boolean };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The most specific active benchmark: scope match beats overall, and a row
 * banded to the grade beats one that is not. Ties go to the first found.
 */
export function selectBenchmark(
  rules: BenchmarkRule[],
  scope: BenchmarkScope,
  scopeId: string | null,
  gradeSort: number
): BenchmarkBands {
  const inBand = (r: BenchmarkRule) =>
    (r.gradeSortMin === null || r.gradeSortMin <= gradeSort) && (r.gradeSortMax === null || r.gradeSortMax >= gradeSort);
  const banded = (r: BenchmarkRule) => r.gradeSortMin !== null || r.gradeSortMax !== null;
  const candidates = rules.filter(inBand);
  const specific = candidates.filter((r) => r.scope === scope && r.scopeId === scopeId);
  const overall = candidates.filter((r) => r.scope === "overall");
  const pick = (list: BenchmarkRule[]) => list.find(banded) ?? list[0];
  const chosen = pick(specific) ?? pick(overall);
  return chosen?.bands ?? [{ key: "below", min_percent: 0 }, { key: "approaching", min_percent: 40 }, { key: "meeting", min_percent: 60 }, { key: "exceeding", min_percent: 80 }];
}

export function computeScores(items: ScoredItem[], rules: BenchmarkRule[], gradeSort: number): Scores {
  const complete = items.every((i) => i.marksAwarded !== null);
  const groups = new Map<string, { scope: BenchmarkScope; scopeId: string | null; raw: number; max: number }>();
  const add = (scope: BenchmarkScope, scopeId: string | null, item: ScoredItem) => {
    const k = `${scope}:${scopeId ?? ""}`;
    const g = groups.get(k) ?? { scope, scopeId, raw: 0, max: 0 };
    g.raw += item.marksAwarded ?? 0;
    g.max += item.marks;
    groups.set(k, g);
  };
  for (const item of items) {
    add("overall", null, item);
    add("subject", item.subjectId, item);
    add("competency", item.competencyId, item);
  }
  const lines: ScoreLine[] = [];
  for (const g of groups.values()) {
    if (g.max <= 0) continue;
    const percent = round2((100 * g.raw) / g.max);
    lines.push({
      scope: g.scope,
      scopeId: g.scopeId,
      raw: round2(g.raw),
      max: round2(g.max),
      percent,
      band: bandFor(percent, selectBenchmark(rules, g.scope, g.scopeId, gradeSort)),
    });
  }
  const order: Record<BenchmarkScope, number> = { overall: 0, subject: 1, competency: 2 };
  lines.sort((a, b) => order[a.scope] - order[b.scope] || (a.scopeId ?? "").localeCompare(b.scopeId ?? ""));
  return { lines, complete };
}
