/**
 * Whether an answer looks AI-written, from three kinds of evidence:
 *
 *   how it was written   recorded in the browser while the applicant typed:
 *                        active time, keystrokes, characters pasted, tab
 *                        switches
 *   what the model says  `assessAiLikelihood`, one call per application
 *   whether it is a copy trigram similarity against every other applicant's
 *                        answer to the same question
 *
 * The verdict is a **flag for a person**, never a mark and never a rejection.
 * AI detectors are wrong often enough, and most often about people writing
 * well in a second language, that the school's rule is: flag, then ask in
 * the interview. The score never reads this.
 *
 * Pure. Unit tested.
 */

/** What the answer box records, as the browser sends it. Every field is optional and untrusted. */
export type WritingBehaviour = {
  activeMs?: number;
  keystrokes?: number;
  pastedChars?: number;
  pasteEvents?: number;
  blurCount?: number;
};

export type ModelLikelihood = "low" | "medium" | "high";

export type IntegrityInput = {
  text: string;
  behaviour: WritingBehaviour;
  model: ModelLikelihood | null;
  duplicateSimilarity: number | null;
};

export type IntegrityReason =
  | "mostly_pasted"
  | "pasted_in_one_go"
  | "implausibly_fast"
  | "model_high"
  | "model_medium"
  | "duplicate";

export type IntegrityVerdict = {
  level: "low" | "medium" | "high" | "unchecked";
  reasons: IntegrityReason[];
  pastedShare: number;
};

export const REASON_LABELS: Record<IntegrityReason, string> = {
  mostly_pasted: "Most of the answer was pasted in rather than typed",
  pasted_in_one_go: "The whole answer arrived in one paste",
  implausibly_fast: "Written faster than a person can type",
  model_high: "The AI check rates it likely to be AI-written",
  model_medium: "The AI check rates it possibly AI-written",
  duplicate: "Almost the same as another applicant's answer",
};

/** Answers shorter than this are not judged: there is too little to go on. */
const MIN_CHARS = 150;
/** A fast typist manages about 400 characters a minute; 900 is not typing. */
const MAX_CHARS_PER_MINUTE = 900;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Cleans what the browser sent: anything odd becomes zero. */
export function cleanBehaviour(raw: unknown): Required<WritingBehaviour> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    activeMs: Math.min(num(r.activeMs), 6 * 3600_000),
    keystrokes: Math.min(num(r.keystrokes), 200_000),
    pastedChars: Math.min(num(r.pastedChars), 200_000),
    pasteEvents: Math.min(num(r.pasteEvents), 10_000),
    blurCount: Math.min(num(r.blurCount), 10_000),
  };
}

export function judgeAnswer(input: IntegrityInput): IntegrityVerdict {
  const text = input.text.trim();
  const length = text.length;
  const b = cleanBehaviour(input.behaviour);
  const pastedShare = length ? Math.min(1, b.pastedChars / length) : 0;
  const reasons: IntegrityReason[] = [];

  if (length >= MIN_CHARS) {
    if (pastedShare >= 0.6) reasons.push("mostly_pasted");
    if (b.pasteEvents === 1 && pastedShare >= 0.9) reasons.push("pasted_in_one_go");
    const typedChars = Math.max(0, length - b.pastedChars);
    if (typedChars >= MIN_CHARS && b.activeMs > 0) {
      const perMinute = typedChars / (b.activeMs / 60_000);
      if (perMinute > MAX_CHARS_PER_MINUTE) reasons.push("implausibly_fast");
    }
  }
  if (input.duplicateSimilarity !== null && input.duplicateSimilarity >= 0.8) reasons.push("duplicate");
  if (input.model === "high") reasons.push("model_high");
  if (input.model === "medium") reasons.push("model_medium");

  const behaviourStrong = reasons.includes("mostly_pasted") || reasons.includes("implausibly_fast");

  let level: IntegrityVerdict["level"];
  if (reasons.includes("duplicate") || input.model === "high" || (behaviourStrong && input.model === "medium")) {
    level = "high";
  } else if (input.model === "medium" || behaviourStrong) {
    level = "medium";
  } else if (input.model === null && length >= MIN_CHARS) {
    // Behaviour alone looked fine but the model has not run yet: say so,
    // rather than calling it clean.
    level = "unchecked";
  } else {
    level = "low";
  }
  return { level, reasons, pastedShare: Math.round(pastedShare * 100) / 100 };
}

/** The application-level summary on the pipeline card and the applicant page. */
export function summariseIntegrity(verdicts: readonly IntegrityVerdict[]): {
  flagged: number;
  high: number;
  unchecked: number;
  total: number;
} {
  return {
    flagged: verdicts.filter((v) => v.level === "high" || v.level === "medium").length,
    high: verdicts.filter((v) => v.level === "high").length,
    unchecked: verdicts.filter((v) => v.level === "unchecked").length,
    total: verdicts.length,
  };
}
