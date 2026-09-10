import { describe, expect, it } from "vitest";
import templates from "@/content/messaging/zavu-templates.json";

/**
 * The templates are approved by Meta and then filled positionally by
 * `sendCompanionMessage`: {{1}} takes the first parameter, {{2}} the second.
 * A body that counts differently from its parameter list does not fail — it
 * sends a parent someone else's number in the wrong slot — so the counting is
 * checked here as well as in the script that prints them.
 */
describe("zavu template content", () => {
  const all = templates.templates;

  it("has one entry per message template key", () => {
    expect(new Set(all.map((t) => t.key)).size).toBe(all.length);
  });

  it.each(all.map((t) => [t.key, t] as const))("%s counts its variables", (_key, t) => {
    const highest = Math.max(0, ...[...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
    expect(highest).toBe(t.parameters.length);
    expect(t.samples).toHaveLength(t.parameters.length);
  });

  it.each(all.map((t) => [t.key, t] as const))("%s fits what Meta accepts", (key, t) => {
    expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(t.body.length).toBeLessThanOrEqual(1024);
    expect(t.body).not.toMatch(/\n|\t/);
    // A template that ends on a variable is refused before it ever reaches
    // Meta, and the trailing full stop does not save it: what follows the
    // last variable has to be words.
    expect(t.body.trimEnd()).not.toMatch(/\{\{\d+\}\}[\s.,!?;:'")\]]*$/);
    if (t.button) expect(t.button.length).toBeLessThanOrEqual(25);
  });

  it.each(all.map((t) => [t.key, t] as const))("%s carries its variables in enough words", (_key, t) => {
    // "This template has too many variables for its length" — Meta's words,
    // for a template with four variables and 49 characters of wording, which
    // works out at 12.3 characters each. The threshold itself is unpublished,
    // so this guards the level we know is refused rather than pretending to
    // know the real one: when a template is rejected for its length, the fix
    // is more words, not a nudge past this number.
    const words = t.body.replace(/\{\{\d+\}\}/g, "").trim().length;
    expect(words / t.parameters.length).toBeGreaterThan(13);
  });

  it("gives the dynamic button an example, which is what Meta rejected without", () => {
    expect(templates.buttonUrl).toContain("{{1}}");
    // The example fills {{1}}; it is not the whole address. Zavu appends it
    // to the pattern, so a full URL here previews as the address twice over.
    expect(templates.buttonExample).not.toContain("{{");
    expect(templates.buttonExample).not.toContain("://");
    expect(templates.buttonExample).not.toContain("/");
  });
});
