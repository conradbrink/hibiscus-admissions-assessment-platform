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
  it("resolves an #if inside an #if, inside-out", () => {
    const t = "{{#if location}}<p>At {{location}}.{{#if parent_first_name}} Ask for {{parent_first_name}}.{{/if}}</p>{{/if}}";
    expect(renderText(t, { location: "Block 7", parent_first_name: "S" }, ALLOWED)).toBe("<p>At Block 7. Ask for S.</p>");
    expect(renderText(t, { location: "Block 7" }, ALLOWED)).toBe("<p>At Block 7.</p>");
    expect(renderText(t, { parent_first_name: "S" }, ALLOWED)).toBe("");
    expect(extractVariables(t)).toEqual(["location", "parent_first_name"]);
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
  it("offers the card button or the bank details, never both wordings", () => {
    // The shape the three payment emails take from 20260918120000. `pay_online`
    // and `transfer_only` are exclusive mirrors, and each arm nests the
    // bank-details block inside itself — the case that would break if the
    // renderer stopped resolving inner blocks first.
    const allowed = ["payment_link", "bank_details", "pay_online", "transfer_only"];
    const t =
      "{{#if pay_online}}<p><a href=\"{{payment_link}}\">Pay securely online</a></p>" +
      "{{#if bank_details}}<p>Or pay by bank transfer:</p><p>{{bank_details}}</p>{{/if}}{{/if}}" +
      "{{#if transfer_only}}{{#if bank_details}}<p>Please pay by bank transfer:</p><p>{{bank_details}}</p>{{/if}}" +
      "<p><a href=\"{{payment_link}}\">See what is due</a></p>{{/if}}";
    const bank = { payment_link: "https://pay", bank_details: "FNB POTCH" };

    const online = renderHtml(t, { ...bank, pay_online: "yes", transfer_only: null }, allowed);
    expect(online).toContain("Pay securely online");
    expect(online).toContain("Or pay by bank transfer:");
    expect(online).not.toContain("Please pay by bank transfer:");
    expect(online).not.toContain("See what is due");

    const transfer = renderHtml(t, { ...bank, pay_online: null, transfer_only: "yes" }, allowed);
    expect(transfer).not.toContain("Pay securely online");
    expect(transfer).toContain("Please pay by bank transfer:");
    expect(transfer).toContain("FNB POTCH");
    // The link still goes, because it is also where the balance is shown.
    expect(transfer).toContain("See what is due");
  });
  it("still says something when a transfer-only campus has no bank details on file", () => {
    const allowed = ["payment_link", "bank_details", "pay_online", "transfer_only"];
    const t =
      "{{#if transfer_only}}{{#if bank_details}}<p>Please pay by bank transfer:</p>{{/if}}" +
      "<p><a href=\"{{payment_link}}\">See what is due</a></p>{{/if}}";
    const out = renderHtml(t, { payment_link: "https://pay", bank_details: null, pay_online: null, transfer_only: "yes" }, allowed);
    expect(out).toBe("<p><a href=\"https://pay\">See what is due</a></p>");
  });
  it("lists missing documents only when there are any", () => {
    const allowed = ["missing_documents"];
    expect(renderText("{{#if missing_documents}}Still needed: {{missing_documents}}{{/if}}", { missing_documents: "Birth certificate" }, allowed)).toBe("Still needed: Birth certificate");
    expect(renderText("{{#if missing_documents}}Still needed: {{missing_documents}}{{/if}}", { missing_documents: null }, allowed)).toBe("");
  });
});
