import type { FlagCode, FlagSeverity } from "@/lib/scoring/score";

/** Short labels for the flag chips on a pipeline card, where the full sentence will not fit. */
export const FLAG_META: Record<FlagCode, { short: string; severity: FlagSeverity }> = {
  safeguarding_reference: { short: "Referee concern", severity: "critical" },
  safeguarding_declared: { short: "Declared a record", severity: "critical" },
  child_protection_not_clear: { short: "Child protection", severity: "critical" },
  safeguarding_answer_weak: { short: "Weak safeguarding answer", severity: "critical" },
  registration_missing: { short: "No registration", severity: "warning" },
  permit_expired: { short: "Permit", severity: "warning" },
  would_not_reemploy: { short: "Not re-employable", severity: "warning" },
  not_recommended: { short: "Not recommended", severity: "warning" },
  no_recent_employer_reference: { short: "No recent-employer reference", severity: "warning" },
  possible_ai_answers: { short: "Possible AI answers", severity: "warning" },
  employment_gap: { short: "Gap in work", severity: "info" },
  overlapping_jobs: { short: "Overlapping jobs", severity: "info" },
  references_outstanding: { short: "References out", severity: "info" },
};

export function flagMeta(code: string): { short: string; severity: FlagSeverity } {
  return FLAG_META[code as FlagCode] ?? { short: code, severity: "info" };
}
