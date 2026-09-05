import { describe, expect, it } from "vitest";
import {
  extractVariables,
  renderHtml,
  renderSubject,
  renderText,
  TemplateRenderError,
  validateTemplate,
} from "@/lib/email/render";

const ALLOWED = ["parent_first_name", "student_first_name", "location", "next_step_link"];

describe("template rendering", () => {
  it("substitutes variables", () => {
    expect(renderText("Dear {{parent_first_name}},", { parent_first_name: "Sarah" }, ALLOWED)).toBe(
      "Dear Sarah,"
    );
  });
  it("escapes HTML in HTML bodies but not in text bodies", () => {
    const vars = { student_first_name: "<b>John</b>" };
    expect(renderHtml("<p>{{student_first_name}}</p>", vars, ALLOWED)).toBe(
      "<p>&lt;b&gt;John&lt;/b&gt;</p>"
    );
    expect(renderText("{{student_first_name}}", vars, ALLOWED)).toBe("<b>John</b>");
  });
  it("includes an #if block only when the variable is non-empty", () => {
    const t = "At {{location}}{{#if location}}, room 4{{/if}}.";
    expect(renderText(t, { location: "Block 7" }, ALLOWED)).toBe("At Block 7, room 4.");
    expect(renderText(t, { location: null }, ALLOWED)).toBe("At .");
    expect(renderText(t, {}, ALLOWED)).toBe("At .");
  });
  it("refuses an unknown variable rather than mailing it", () => {
    expect(() => renderText("{{parent_frist_name}}", {}, ALLOWED)).toThrow(TemplateRenderError);
  });
  it("refuses an unclosed #if", () => {
    expect(validateTemplate("{{#if location}}x", ALLOWED)).toEqual([{ kind: "unclosed_if" }]);
  });
  it("lists every variable a template uses, including inside #if", () => {
    expect(
      extractVariables("{{#if location}}{{location}}{{/if}} {{ parent_first_name }}")
    ).toEqual(["location", "parent_first_name"]);
  });
  it("collapses whitespace in subjects", () => {
    expect(renderSubject("  Hello   {{parent_first_name}} ", { parent_first_name: "S" }, ALLOWED)).toBe(
      "Hello S"
    );
  });
  it("does not interpret anything a parent typed", () => {
    // A child named "{{next_step_link}}" gets their name printed, not a link.
    const out = renderText("Hi {{student_first_name}}", { student_first_name: "{{next_step_link}}" }, ALLOWED);
    expect(out).toBe("Hi {{next_step_link}}");
  });
  it("renders the payment email shapes: an optional bank-details block and a pre-line body", () => {
    const allowed = ["amount_due", "payment_link", "bank_details", "application_reference"];
    const t = "<p>Pay {{amount_due}}</p>{{#if bank_details}}<p style=\"white-space:pre-line\">{{bank_details}}</p><p>Ref {{application_reference}}</p>{{/if}}";
    const withBank = renderHtml(t, { amount_due: "P 7,500.00", payment_link: "x", bank_details: "FNB\nAccount 1 & 2", application_reference: "HBS-1" }, allowed);
    expect(withBank).toBe("<p>Pay P 7,500.00</p><p style=\"white-space:pre-line\">FNB\nAccount 1 &amp; 2</p><p>Ref HBS-1</p>");
    const without = renderHtml(t, { amount_due: "P 7,500.00", payment_link: "x", bank_details: null, application_reference: "HBS-1" }, allowed);
    expect(without).toBe("<p>Pay P 7,500.00</p>");
  });
  it("lists missing documents only when there are any", () => {
    const allowed = ["missing_documents"];
    expect(renderText("{{#if missing_documents}}Still needed: {{missing_documents}}{{/if}}", { missing_documents: "Birth certificate" }, allowed)).toBe("Still needed: Birth certificate");
    expect(renderText("{{#if missing_documents}}Still needed: {{missing_documents}}{{/if}}", { missing_documents: null }, allowed)).toBe("");
  });
});
