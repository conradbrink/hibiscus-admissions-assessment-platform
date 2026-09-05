import { z } from "zod";
import { BAND_LABELS } from "@/lib/assessment/bands";
import type { ComputedProfile } from "@/lib/profile/compute";

/**
 * The narrative: its shape, the deterministic version, and the validator
 * that stands between the AI's version and the parent.
 *
 * The validator is the guarantee the design makes: an AI sentence reaches a
 * parent only if every number in it was computed by us and no word in it
 * diagnoses, labels or ranks the child. Anything else falls back to the
 * deterministic wording, which is bland by design and safe by construction.
 */

export const NARRATIVE_SCHEMA = z.object({
  summary: z.string().min(20).max(900),
  strengths_text: z.string().min(0).max(700),
  development_text: z.string().min(0).max(700),
});

export type Narrative = z.infer<typeof NARRATIVE_SCHEMA>;

export const PROMPT_VERSION = "profile-narrative-v1";

/**
 * Words that turn an academic summary into a diagnosis or a verdict. Matched
 * case-insensitively as whole words or stems. Deliberately broad: a false
 * positive costs the fallback wording, a false negative costs a parent
 * reading something no assessment can support.
 */
export const BANNED_TERMS: RegExp[] = [
  /\bADHD\b/i,
  /\bADD\b/,
  /\bautis\w*/i,
  /\bdyslex\w*/i,
  /\bdyscalc\w*/i,
  /\bdysprax\w*/i,
  /\bdisorder\w*/i,
  /\bdisabilit\w*/i,
  /\bdiagnos\w*/i,
  /\bcondition\b/i,
  /\bsyndrome\b/i,
  /\bIQ\b/,
  /\bintelligen\w*/i,
  /\bgifted\b/i,
  /\btalented\b/i,
  /\bgenius\b/i,
  /\bslow\b/i,
  /\bbehind\b/i,
  /\bbelow average\b/i,
  /\babove average\b/i,
  /\blearning (difficult|disabilit|disorder)\w*/i,
  /\bconcentrat\w*/i,
  /\battention\b/i,
  /\bhyperactiv\w*/i,
  /\banxi\w*/i,
  /\bdepress\w*/i,
  /\btherap\w*/i,
  /\bpsycholog\w*/i,
  /\bclinical\w*/i,
  /\bmedical\w*/i,
  /\bspecial needs\b/i,
  /\bremedial\b/i,
  /\bfail\w*/i,
  /\breject\w*/i,
  /\baccept\w*/i,
  /\badmit\w*/i,
  /\boffer\b/i,
  /\bpercentile\b/i,
  /\brank\w*/i,
  /\bcompar\w* (to|with) (other|peer)\w*/i,
];

export type ValidationProblem = { kind: "number" | "term" | "name" | "length"; detail: string };

/**
 * Every number in the prose must be one we computed; no banned term; the
 * child's surname must not appear; the pieces must be within length.
 */
export function validateNarrative(
  narrative: Narrative,
  computed: ComputedProfile,
  names: { firstName: string; lastName: string }
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const text = `${narrative.summary}\n${narrative.strengths_text}\n${narrative.development_text}`;

  const allowed = new Set(computed.allowedNumbers.map((n) => Math.round(n * 100)));
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(",", "."));
    if (!allowed.has(Math.round(n * 100))) problems.push({ kind: "number", detail: m[0] });
  }

  for (const re of BANNED_TERMS) {
    const m = text.match(re);
    if (m) problems.push({ kind: "term", detail: m[0] });
  }

  if (names.lastName.length >= 2 && new RegExp(`\\b${escapeRe(names.lastName)}\\b`, "i").test(text)) {
    problems.push({ kind: "name", detail: "surname" });
  }

  if (text.length > 2000) problems.push({ kind: "length", detail: String(text.length) });
  return problems;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plain, safe wording from the computed profile alone. */
export function fallbackNarrative(computed: ComputedProfile, firstName: string): Narrative {
  const name = firstName || "Your child";
  const overall = computed.overall
    ? `${name} achieved an overall result of ${fmt(computed.overall.percent)}% (${BAND_LABELS[computed.overall.band].toLowerCase()}).`
    : `${name} completed the assessment.`;
  const subjects = computed.subjects.length
    ? ` By subject: ${computed.subjects.map((s) => `${s.name} ${fmt(s.percent)}%`).join(", ")}.`
    : "";
  const summary = `${overall}${subjects} This profile summarises what the assessment measured on the day; it is a snapshot of academic skills, not a judgement of ability.`;

  const strengths_text = computed.strengths.length
    ? `${name} did particularly well in ${list(computed.strengths.map((s) => `${s.name} (${fmt(s.percent)}%)`))}.`
    : "";
  const development_text = computed.development.length
    ? `The areas where more practice would help most are ${list(computed.development.map((d) => `${d.name} (${fmt(d.percent)}%)`))}. Recommended focus: ${list(computed.focus)}.`
    : "No area stood out as needing particular attention.";

  return { summary, strengths_text, development_text };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What the model is told. Short, and explicit about what it may not do. */
export function narrativeSystemPrompt(): string {
  return [
    "You write the narrative section of a school learning profile for a parent, from assessment data supplied as JSON.",
    "Audience: the child's parent. Tone: warm, plain, specific, British English. Use the child's first name.",
    "Rules that are not negotiable:",
    "- Use only the numbers in the data. Never compute, estimate, round or invent a number.",
    "- Describe academic skills the assessment measured. Never describe intelligence, ability, potential, personality, behaviour, attention, effort or emotion.",
    "- Never diagnose, label, or suggest a condition, and never compare the child to other children.",
    "- Never mention admission, offers, places, acceptance or the school's decision.",
    "- Do not use the words: intelligence, gifted, talented, slow, behind, average, disorder, condition, diagnosis, attention, concentration.",
    "- summary: two to four sentences on the overall picture. strengths_text: one or two sentences on the strengths listed, naming each with its percentage. development_text: one or two sentences on the development areas listed, naming each with its percentage, ending with the recommended focus.",
    "- If a list is empty, leave that field as an empty string.",
  ].join("\n");
}

export function narrativeInput(computed: ComputedProfile, firstName: string, gradeName: string): string {
  return JSON.stringify(
    {
      first_name: firstName,
      grade_applied_for: gradeName,
      overall_percent: computed.overall?.percent ?? null,
      overall_band: computed.overall ? BAND_LABELS[computed.overall.band] : null,
      subjects: computed.subjects.map((s) => ({ name: s.name, percent: s.percent, band: BAND_LABELS[s.band] })),
      competencies: computed.competencies.map((c) => ({ name: c.name, percent: c.percent, band: BAND_LABELS[c.band] })),
      strengths: computed.strengths.map((s) => ({ name: s.name, percent: s.percent })),
      development_areas: computed.development.map((d) => ({ name: d.name, percent: d.percent })),
      recommended_focus: computed.focus,
    },
    null,
    2
  );
}
