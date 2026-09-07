import { describe, expect, it } from "vitest";
import { htmlToBlocks, htmlToParagraphs } from "@/lib/documents/offer-pdf";

describe("htmlToBlocks", () => {
  it("turns the letter into headings, paragraphs and the place of the fee table", () => {
    const html = '<h1>Offer of Admission</h1><p><strong>OFFER LETTER: Lesedi Aimark</strong></p><p>Dear <strong>Kagiso</strong>, welcome.</p><table class="details"><tr><td>Application fee</td><td>P 300.00</td></tr></table><p>Kind regards,<br>Admissions</p>';
    expect(htmlToBlocks(html, { dropLeadingHeading: "Offer of Admission" })).toEqual([
      { kind: "heading", text: "OFFER LETTER: Lesedi Aimark" },
      { kind: "para", text: "Dear Kagiso, welcome." },
      { kind: "fees", text: "" },
      { kind: "para", text: "Kind regards," },
      { kind: "para", text: "Admissions" },
    ]);
    expect(htmlToParagraphs(html)).toEqual(["Offer of Admission", "OFFER LETTER: Lesedi Aimark", "Dear Kagiso, welcome.", "Kind regards,", "Admissions"]);
  });
});
