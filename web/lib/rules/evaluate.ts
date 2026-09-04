import type { BenchmarkScope, DecisionOutcome, RuleOperator, RuleSeverity } from "@/lib/supabase/types";

/**
 * The admission rules engine. Pure, and the only place an outcome is
 * computed from scores.
 *
 * Order matters and is fixed: any hard-fail rule violated → declined; any
 * review rule violated → staff review; everything passes and a place is
 * free → approved; everything passes and none is → waitlisted. No ruleset
 * at all → staff review, because "nobody has written the rules yet" must
 * never mean "everybody is approved" or "everybody is declined".
 *
 * A rule whose scope has no score (a competency the sitting did not cover)
 * cannot be verified and is treated as a review, whatever its severity.
 */

export type Rule = {
  id?: string;
  scope: BenchmarkScope;
  scopeId: string | null;
  operator: RuleOperator;
  threshold: number;
  severity: RuleSeverity;
  label: string;
};

export type ScoreInput = { scope: BenchmarkScope; scopeId: string | null; percent: number };

export type RuleResult = {
  rule: Rule;
  actual: number | null;
  passed: boolean;
  /** What the failure meant: the severity, or "unverifiable". */
  effect: "pass" | "hard_fail" | "review" | "unverifiable";
};

export type Evaluation = {
  outcome: DecisionOutcome;
  results: RuleResult[];
  /** One line a person can read on the review queue. */
  reason: string;
  placesRemaining: number | null;
};

function compare(actual: number, op: RuleOperator, threshold: number): boolean {
  switch (op) {
    case ">=":
      return actual >= threshold;
    case ">":
      return actual > threshold;
    case "<=":
      return actual <= threshold;
    case "<":
      return actual < threshold;
  }
}

export function evaluateAdmission(input: {
  scores: ScoreInput[];
  /** Null when no active ruleset covers the applicant. */
  rules: Rule[] | null;
  /** Null when capacity is unlimited. */
  placesRemaining: number | null;
}): Evaluation {
  const { rules, placesRemaining } = input;
  if (rules === null) {
    return {
      outcome: "staff_review",
      results: [],
      reason: "No active admission ruleset covers this applicant, so a person decides.",
      placesRemaining,
    };
  }

  const results: RuleResult[] = rules.map((rule) => {
    const line = input.scores.find((s) => s.scope === rule.scope && (s.scopeId ?? null) === (rule.scopeId ?? null));
    if (!line) return { rule, actual: null, passed: false, effect: "unverifiable" };
    const passed = compare(line.percent, rule.operator, rule.threshold);
    return { rule, actual: line.percent, passed, effect: passed ? "pass" : rule.severity };
  });

  const hard = results.filter((r) => r.effect === "hard_fail");
  if (hard.length) {
    return {
      outcome: "declined",
      results,
      reason: `Did not meet: ${hard.map((r) => r.rule.label).join("; ")}.`,
      placesRemaining,
    };
  }
  const review = results.filter((r) => r.effect === "review" || r.effect === "unverifiable");
  if (review.length) {
    return {
      outcome: "staff_review",
      results,
      reason: `Needs a person's judgement: ${review.map((r) => (r.effect === "unverifiable" ? `${r.rule.label} (no score)` : r.rule.label)).join("; ")}.`,
      placesRemaining,
    };
  }
  if (placesRemaining !== null && placesRemaining <= 0) {
    return { outcome: "waitlisted", results, reason: "Met every criterion; no place is available at present.", placesRemaining };
  }
  return { outcome: "approved", results, reason: "Met every criterion.", placesRemaining };
}
