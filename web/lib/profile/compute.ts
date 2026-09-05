import type { BenchmarkBand } from "@/lib/supabase/types";

/**
 * Everything numeric on a learning profile, and every list on it, computed
 * from the scores. Pure. The AI receives this and writes prose; it computes
 * nothing, and the validator refuses any number it did not receive.
 */

export type ScoreLineInput = {
  scope: "overall" | "subject" | "competency";
  scopeId: string | null;
  percent: number;
  band: BenchmarkBand;
};

export type CompetencyMeta = {
  id: string;
  name: string;
  subjectId: string;
  focusLabel: string | null;
  reportable: boolean;
  sortOrder: number;
};

export type SubjectMeta = { id: string; name: string; sortOrder: number };

export type ProfileLine = {
  id: string;
  name: string;
  percent: number;
  band: BenchmarkBand;
  /** Set on competency lines, so a page can group them under their subject. */
  subjectId?: string;
};

export type ComputedProfile = {
  overall: { percent: number; band: BenchmarkBand } | null;
  subjects: ProfileLine[];
  competencies: ProfileLine[];
  /** Reportable competencies at meeting or above, strongest first, up to three. */
  strengths: ProfileLine[];
  /** Reportable competencies below meeting, weakest first, up to three. */
  development: ProfileLine[];
  /** The development areas' focus labels, in the same order. */
  focus: string[];
  /** Every number that may appear in the narrative. */
  allowedNumbers: number[];
};

const STRONG: BenchmarkBand[] = ["meeting", "exceeding"];

export function computeProfile(
  lines: ScoreLineInput[],
  competencies: CompetencyMeta[],
  subjects: SubjectMeta[]
): ComputedProfile {
  const overallLine = lines.find((l) => l.scope === "overall") ?? null;
  const overall = overallLine ? { percent: overallLine.percent, band: overallLine.band } : null;

  const subjectLines: ProfileLine[] = subjects
    .map((s) => {
      const l = lines.find((x) => x.scope === "subject" && x.scopeId === s.id);
      return l ? { id: s.id, name: s.name, percent: l.percent, band: l.band } : null;
    })
    .filter((x): x is ProfileLine => x !== null);

  const reportable = competencies.filter((c) => c.reportable).sort((a, b) => a.sortOrder - b.sortOrder);
  const competencyLines: ProfileLine[] = reportable
    .map((c): ProfileLine | null => {
      const l = lines.find((x) => x.scope === "competency" && x.scopeId === c.id);
      return l ? { id: c.id, name: c.name, percent: l.percent, band: l.band, subjectId: c.subjectId } : null;
    })
    .filter((x): x is ProfileLine => x !== null);

  const strengths = competencyLines
    .filter((c) => STRONG.includes(c.band))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 3);
  const development = competencyLines
    .filter((c) => !STRONG.includes(c.band))
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 3);
  const focus = development.map((d) => competencies.find((c) => c.id === d.id)?.focusLabel ?? d.name);

  const allowedNumbers = [
    ...(overall ? [overall.percent] : []),
    ...subjectLines.map((s) => s.percent),
    ...competencyLines.map((c) => c.percent),
  ];

  return { overall, subjects: subjectLines, competencies: competencyLines, strengths, development, focus, allowedNumbers };
}
