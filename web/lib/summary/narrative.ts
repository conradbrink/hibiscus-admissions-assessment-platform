import { createHash } from "node:crypto";
import { z } from "zod";
import { BANNED_TERMS } from "@/lib/profile/narrative";
import type { Flag } from "@/lib/summary/facts";

/**
 * The prose over the facts: its shape, the deterministic version, the
 * validator, and the hash that says whether stored prose is still current.
 * Pure and tested.
 */

export const SUMMARY_SCHEMA = z.object({
  headline: z.string().min(10).max(200),
  paragraph: z.string().min(20).max(700),
});
export type SummaryProse = z.infer<typeof SUMMARY_SCHEMA>;

export const SUMMARY_PROMPT_VERSION = "application-summary-v1";

export function inputHash(facts: string[], flags: Flag[]): string {
  return createHash("sha256").update(JSON.stringify({ facts, flags: flags.map((f) => [f.kind, f.evidence]) })).digest("base64url");
}

export type SummaryProblem = { kind: "number" | "term" | "length"; detail: string };

/**
 * The profile's banned terms minus the process words a staff summary has to
 * use (offer, accept, admit, decline…): what stays is everything that would
 * describe, judge or diagnose the child.
 */
const PROCESS_WORDS = /accept|admit|offer|fail|reject|percentile|rank|compar/;
export const SUMMARY_BANNED_TERMS: RegExp[] = BANNED_TERMS.filter((re) => !PROCESS_WORDS.test(re.source));

/**
 * Every number in the prose must appear in the facts; no term that judges
 * or diagnoses the child; within length. The staff reader sees the source
 * either way; the validator decides which source it is.
 */
export function validateSummary(prose: SummaryProse, facts: string[]): SummaryProblem[] {
  const problems: SummaryProblem[] = [];
  const text = `${prose.headline}\n${prose.paragraph}`;
  const factText = facts.join("\n");
  const allowed = new Set([...factText.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]));
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    if (!allowed.has(m[0])) problems.push({ kind: "number", detail: m[0] });
  }
  for (const re of SUMMARY_BANNED_TERMS) {
    const m = text.match(re);
    if (m) problems.push({ kind: "term", detail: m[0] });
  }
  if (text.length > 900) problems.push({ kind: "length", detail: String(text.length) });
  return problems;
}

/** Plain wording from the facts alone: the first fact as the headline, the rest as the paragraph. */
export function fallbackSummary(facts: string[], flags: Flag[]): SummaryProse {
  const headline = (facts[0] ?? "No facts yet.").slice(0, 200);
  const body = facts.slice(1).join(" ");
  const followUp = flags.length ? ` To follow up: ${flags.map((f) => f.label.toLowerCase()).join(", ")}.` : "";
  const paragraph = `${body}${followUp}`.trim() || "Nothing has happened on this application yet.";
  return { headline, paragraph: paragraph.length > 700 ? paragraph.slice(0, 697) + "…" : paragraph.padEnd(20, " ").trimEnd().length < 20 ? paragraph + " Nothing further to report." : paragraph };
}

export function summarySystemPrompt(): string {
  return [
    "You write a two-part summary of a school admissions application for a member of admissions staff, from facts supplied as JSON.",
    "Audience: staff who know the process. Tone: plain, factual, British English, present tense for the current state.",
    "Rules that are not negotiable:",
    "- Use only the facts given. Never add, infer or soften a fact. Never invent a date, a number or a reason.",
    "- Use only numbers that appear in the facts, written the same way.",
    "- Describe the application's progress. Never describe the child's ability, personality, behaviour, or potential, and never diagnose or label.",
    "- Do not recommend a decision. The follow-up items are given; you may restate them, not extend them.",
    "- headline: one sentence, under 200 characters, saying where the application stands and what happens next.",
    "- paragraph: three to five sentences, under 700 characters, telling the story in order and ending with what is to follow up, if anything.",
    "- Do not use the words: attention, concentration, intelligence, gifted, talented, slow, behind, average, disorder, condition, diagnosis.",
  ].join("\n");
}

export function summaryInput(facts: string[], flags: Flag[]): string {
  return JSON.stringify({ facts, follow_up: flags.map((f) => ({ what: f.label, evidence: f.evidence })) }, null, 2);
}
