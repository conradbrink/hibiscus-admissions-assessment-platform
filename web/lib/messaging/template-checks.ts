import { placeholderCount } from "@/lib/messaging/meta-payload";

/**
 * What makes a template mapping unsaveable.
 *
 * This lives away from the editor because both sides run it: the editor
 * calls it on every keystroke so the Save button is honest, and the server
 * action calls it again before writing, since a form post is not obliged to
 * have come from our form.
 *
 * It used to be exported from the editor itself, which is a `"use client"`
 * module — and every export of one of those is a client reference, so the
 * server action's call reached a stub and threw "Attempted to call
 * templateProblems() from the server". The browser-side check passed, the
 * page looked fine, and the error appeared only when somebody pressed Save.
 * A pure function shared across the boundary belongs in neither half.
 *
 * Zavu is the only provider a template is addressed by here. The Meta and
 * Twilio adapters still work and their columns still hold whatever was in
 * them, but nothing sets those from the console any more, so there is no
 * "whichever provider is sending" to check against.
 */

/**
 * Does this wording read the word "assessment" to somebody who is not sitting
 * one?
 *
 * The twin of `pg_temp.says_assessment` in
 * `supabase/tests/template_coverage.sql`, which guards the same rule across the
 * whole template surface at build time. This one guards the send. A member of
 * staff picking a template by hand had no such check, and a pre-school parent
 * was sent "Brock's assessment at Phase 2 is booked" a second after the
 * play-date confirmation she had already had.
 *
 * Placeholders come out first — a variable named `assessment_date` is not the
 * parent reading the word. The denial is then stripped, narrowly and only in
 * the phrasing the approved wording uses: saying a pre-school child does *not*
 * sit an assessment is the clearest way to serve the rule this exists for, and
 * a substring search cannot tell a denial from a claim. "The assessment"
 * anywhere else in the same template still counts.
 *
 * Keep the two in step: a change here wants the same change there.
 */
export function saysAssessment(text: string | null | undefined): boolean {
  return (text ?? "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/(do|does)( not|es not|n't) sit an assessment/gi, "")
    .toLowerCase()
    .includes("assess");
}

export function templateProblems(input: {
  parameters: string[];
  bodyPreview: string;
  allowed: string[];
  zavuTemplateId?: string;
  active: boolean;
}): string[] {
  const problems: string[] = [];
  const unknown = input.parameters.filter((p) => !input.allowed.includes(p));
  if (unknown.length) problems.push(`Not an allowed variable for this email: ${unknown.join(", ")}`);
  const links = input.parameters.filter((p) => p.endsWith("_link"));
  if (links.length) problems.push(`Links go on the button, not in the text: ${links.join(", ")}`);
  const n = placeholderCount(input.bodyPreview);
  if (n !== input.parameters.length) problems.push(`The wording has ${n} placeholder(s) but ${input.parameters.length} variable(s) are listed`);
  if (input.active && !(input.zavuTemplateId ?? "").trim()) {
    problems.push("An active template needs its Zavu template id");
  }
  return problems;
}
