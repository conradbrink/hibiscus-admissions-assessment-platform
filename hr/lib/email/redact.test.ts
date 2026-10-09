import { describe, expect, it } from "vitest";
import { REDACTED, redactLinks } from "@/lib/email/redact";

const token = "7v-vl2tar0uFSFaqDzZiA95A1CGo_tIQ7shc41tcseM";

describe("stored email copies", () => {
  it("lose applicant, referee and payslip links", () => {
    for (const p of ["h", "r", "p"]) {
      expect(redactLinks(`Open it: https://hr.example.org/${p}/${token}\nThanks`)).toBe(`Open it: ${REDACTED}\nThanks`);
    }
  });

  it("lose the link inside an HTML button too", () => {
    expect(redactLinks(`<a href="https://hr.example.org/p/${token}" class="button">Open</a>`)).toBe(`<a href="${REDACTED}" class="button">Open</a>`);
  });

  it("keep ordinary links", () => {
    const body = "See https://hr.example.org/vacancies/grade-r-teacher and https://www.hibiscusschools.com/p/about";
    expect(redactLinks(body)).toBe(body);
  });
});
