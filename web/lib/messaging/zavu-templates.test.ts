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
    // A template that ends on a variable reads as unfinished and is a
    // documented rejection reason.
    expect(t.body.trimEnd()).not.toMatch(/\{\{\d+\}\}$/);
    if (t.button) expect(t.button.length).toBeLessThanOrEqual(25);
  });

  it("gives the dynamic button an example, which is what Meta rejected without", () => {
    expect(templates.buttonUrl).toContain("{{1}}");
    expect(templates.buttonExample).not.toContain("{{");
    expect(templates.buttonExample.startsWith(templates.buttonUrl.replace("{{1}}", ""))).toBe(true);
  });
});
