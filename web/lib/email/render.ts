/**
 * Template rendering with an allow-list.
 *
 * Syntax, deliberately tiny:
 *   {{name}}                 substitute; HTML-escaped in HTML bodies
 *   {{#if name}}…{{/if}}     include when the variable is non-empty
 *
 * A variable that is not in the template's allow-list fails validation, so a
 * typo is caught in the editor at save time rather than mailed to a parent as
 * a literal "{{parent_frist_name}}". Nothing else is interpreted: no loops,
 * no expressions, no raw HTML from data.
 *
 * Pure. Unit tested.
 */

export type TemplateVariables = Record<string, string | null | undefined>;

const VAR = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
const IF_BLOCK = /\{\{#if\s+([a-z][a-z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Every variable name a template text refers to, including inside #if. */
export function extractVariables(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(IF_BLOCK)) found.add(m[1]);
  for (const m of text.matchAll(VAR)) found.add(m[1]);
  return [...found].sort();
}

export type TemplateProblem = { kind: "unknown_variable"; name: string } | { kind: "unclosed_if" };

/** Problems that would make a template unsafe to activate. Empty means fine. */
export function validateTemplate(text: string, allowed: readonly string[]): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const allowedSet = new Set(allowed);
  for (const name of extractVariables(text)) {
    if (!allowedSet.has(name)) problems.push({ kind: "unknown_variable", name });
  }
  const opens = (text.match(/\{\{#if\s/g) ?? []).length;
  const closes = (text.match(/\{\{\/if\}\}/g) ?? []).length;
  if (opens !== closes) problems.push({ kind: "unclosed_if" });
  return problems;
}

export class TemplateRenderError extends Error {
  constructor(public readonly problems: TemplateProblem[]) {
    super(
      "Template cannot be rendered: " +
        problems
          .map((p) => (p.kind === "unknown_variable" ? `unknown variable ${p.name}` : "unclosed {{#if}}"))
          .join(", ")
    );
    this.name = "TemplateRenderError";
  }
}

function render(
  text: string,
  vars: TemplateVariables,
  allowed: readonly string[],
  escape: (s: string) => string
): string {
  const problems = validateTemplate(text, allowed);
  if (problems.length) throw new TemplateRenderError(problems);
  const withBlocks = text.replace(IF_BLOCK, (_m, name: string, inner: string) =>
    vars[name] ? inner : ""
  );
  return withBlocks.replace(VAR, (_m, name: string) => escape(vars[name] ?? ""));
}

export function renderText(text: string, vars: TemplateVariables, allowed: readonly string[]): string {
  return render(text, vars, allowed, (s) => s);
}

export function renderHtml(html: string, vars: TemplateVariables, allowed: readonly string[]): string {
  return render(html, vars, allowed, escapeHtml);
}

/** Subject lines are plain text but can carry the same variables. */
export function renderSubject(subject: string, vars: TemplateVariables, allowed: readonly string[]): string {
  return renderText(subject, vars, allowed).replace(/\s+/g, " ").trim();
}
