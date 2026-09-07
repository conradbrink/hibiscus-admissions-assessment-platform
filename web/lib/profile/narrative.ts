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

export const PROMPT_VERSION = "profile-narrative-v3";

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
  names: { firstName: string; lastName: string; gradeName?: string }
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const text = `${narrative.summary}\n${narrative.strengths_text}\n${narrative.development_text}`;

  // "Form 1" or "Stage 7" is the grade, not a result: those digits are not
  // claims about the child and are set aside before the numbers are checked.
  let numeric = names.gradeName ? text.replace(new RegExp(escapeRe(names.gradeName), "gi"), " ") : text;
  numeric = numeric.replace(/\b(Form|Stage|Grade|Year|Term|Reception)\s+\d+\b/gi, " ");
  const allowed = new Set(computed.allowedNumbers.map((n) => Math.round(n * 100)));
  for (const m of numeric.matchAll(/\d+(?:[.,]\d+)?/g)) {
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
  const summary = `${overall}${subjects} This profile shows what the assessment measured on the day. It describes skills, not ability.`;

  const strengths_text = computed.strengths.length
    ? `${name} did well in ${list(computed.strengths.map((s) => `${s.name} (${fmt(s.percent)}%)`))}.`
    : "";
  const development_text = computed.development.length
    ? `More practice would help in ${list(computed.development.map((d) => `${d.name} (${fmt(d.percent)}%)`))}. Focus on: ${list(computed.focus)}.`
    : "No area needed special attention.";

  return { summary, strengths_text, development_text };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What the marking showed, in words rather than marks, so the narrative can
 * say what the child did rather than recite percentages the report already
 * prints. Counts become words on purpose: the validator allows no digit the
 * profile did not compute, and "all six" would be one.
 */
export type NarrativeEvidence = {
  /** Objective questions, grouped by skill: how the child fared. */
  objective: Array<{ skill: string; outcome: "all correct" | "most correct" | "about half correct" | "few correct" | "none correct" }>;
  /** Written answers: the task, the band it earned, and the marker's note. */
  written: Array<{ skill: string; task: string; result: string; note: string | null }>;
};

export type EvidenceRow = {
  skill: string;
  type: string;
  task: string;
  isCorrect: boolean | null;
  marksAwarded: number | null;
  marksAvailable: number;
  bandLabel: string | null;
  note: string | null;
};

export function outcomeWord(correct: number, total: number): NarrativeEvidence["objective"][number]["outcome"] {
  if (total === 0 || correct === 0) return "none correct";
  if (correct === total) return "all correct";
  const share = correct / total;
  if (share >= 2 / 3) return "most correct";
  if (share >= 1 / 3) return "about half correct";
  return "few correct";
}

export function marksWord(awarded: number, available: number): string {
  if (available <= 0) return "marked";
  const share = awarded / available;
  if (share >= 1) return "full marks";
  if (share >= 0.75) return "most of the marks";
  if (share >= 0.4) return "about half the marks";
  if (share > 0) return "a few of the marks";
  return "no marks";
}

export function buildEvidence(rows: EvidenceRow[]): NarrativeEvidence {
  const tally = new Map<string, { correct: number; total: number }>();
  const written: NarrativeEvidence["written"] = [];
  for (const r of rows) {
    if (r.type === "extended_text") {
      if (r.marksAwarded === null) continue;
      written.push({
        skill: r.skill,
        task: stripDigits(r.task),
        result: r.bandLabel ?? marksWord(Number(r.marksAwarded), r.marksAvailable),
        note: r.note ? stripDigits(r.note) : null,
      });
      continue;
    }
    if (r.isCorrect === null) continue;
    const t = tally.get(r.skill) ?? { correct: 0, total: 0 };
    t.total += 1;
    if (r.isCorrect) t.correct += 1;
    tally.set(r.skill, t);
  }
  const objective = [...tally.entries()].map(([skill, t]) => ({ skill, outcome: outcomeWord(t.correct, t.total) }));
  return { objective, written };
}

/** A question or a note about the answer may carry digits; the narrative may not, so none are shown to the model. */
function stripDigits(text: string): string {
  return text.replace(/\d+(?:[.,\/]\d+)?/g, "[number]").slice(0, 400);
}

/**
 * The plain-English rules every sentence the platform writes to a parent
 * follows (CEFR B1 to B2). Shared with the prompts so the model writes the
 * way the templates do.
 */
export const PLAIN_ENGLISH_RULES = [
  "Write for a parent whose English may be their second or third language: CEFR level B1 to B2.",
  "Short sentences, 10 to 20 words each. One idea per sentence.",
  "Common words: say use, not utilise; help, not facilitate; show, not demonstrate.",
  "Active voice: 'Lesedi answered every question', not 'every question was answered'.",
  "No idioms, no slang, no phrases that only make sense in one country.",
  "Be direct. No filler and no corporate language.",
  "If a technical word cannot be avoided, explain it in the same sentence.",
  "Use the same word for the same thing every time.",
];

/** What the model is told. Explicit about what it may not do, and about what a parent finds useful. */
export function narrativeSystemPrompt(): string {
  return [
    "You write the narrative of a school assessment report that an assessor prints and talks a parent through.",
    "The report already prints every percentage and band in tables. The narrative is the part that explains what the results mean: what the child showed they can do, where practice would help, and what would help next. Do not recite the tables.",
    "Audience: the child's parent. Tone: warm, plain, specific, British English. Use the child's first name. Write about the work, with evidence from the data: which kinds of question were handled securely, what the written work showed, where marks were lost.",
    "How to write:",
    ...PLAIN_ENGLISH_RULES.map((r) => `- ${r}`),
    "Rules that are not negotiable:",
    "- The only digits allowed anywhere are the overall percentage, written once at most. Every other quantity is written in words or left out. Never copy a number from a note.",
    "- Describe academic skills the assessment measured. Never describe intelligence, ability, potential, personality, behaviour, attention, effort or emotion.",
    "- Never diagnose, label, or suggest a condition, and never compare the child to other children.",
    "- Never mention admission, offers, places, acceptance or the school's decision.",
    "- Do not use the words: intelligence, gifted, talented, slow, behind, average, disorder, condition, diagnosis, attention, concentration.",
    "- summary: three to five sentences. The overall picture in a sentence, then what the child showed in each subject, drawing on the evidence. No list of skills with percentages.",
    "- strengths_text: two or three sentences on the strengths listed: what each skill means in practice and what in the work showed it. No percentages.",
    "- development_text: two to four sentences. If development areas are listed, say where practice would help and why, then one or two concrete things to do at home and at school, ending with the recommended focus. If none are listed, say so plainly and use the room_to_grow areas to suggest what would take the work further.",
    "- If strengths is empty, leave strengths_text as an empty string.",
  ].join("\n");
}

export function narrativeInput(
  computed: ComputedProfile,
  firstName: string,
  gradeName: string,
  evidence?: NarrativeEvidence,
  previousProblems?: ValidationProblem[]
): string {
  const roomToGrow = computed.development.length
    ? []
    : [...computed.competencies].filter((c) => c.percent < 100).sort((a, b) => a.percent - b.percent).slice(0, 2);
  return JSON.stringify(
    {
      first_name: firstName,
      grade_applied_for: gradeName,
      overall_percent: computed.overall?.percent ?? null,
      overall_band: computed.overall ? BAND_LABELS[computed.overall.band] : null,
      subjects: computed.subjects.map((s) => ({ name: s.name, band: BAND_LABELS[s.band] })),
      skills: computed.competencies.map((c) => ({ name: c.name, band: BAND_LABELS[c.band] })),
      strengths: computed.strengths.map((s) => s.name),
      development_areas: computed.development.map((d) => d.name),
      room_to_grow: roomToGrow.map((c) => ({ name: c.name, band: BAND_LABELS[c.band] })),
      recommended_focus: computed.focus,
      evidence: evidence ?? { objective: [], written: [] },
      ...(previousProblems?.length
        ? {
            previous_attempt_rejected: previousProblems.map((p) =>
              p.kind === "number"
                ? `the text contained the number ${p.detail}, which is not the overall percentage; write it in words or leave it out`
                : p.kind === "term"
                  ? `the text used the word "${p.detail}", which is not allowed`
                  : p.kind === "name"
                    ? "the text used the child's surname"
                    : "the text was too long"
            ),
          }
        : {}),
    },
    null,
    2
  );
}
