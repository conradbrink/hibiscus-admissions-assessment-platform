import { describe, expect, it } from "vitest";
import { htmlToBlocks, withSignatory, htmlToParagraphs } from "@/lib/documents/offer-pdf";

describe("htmlToBlocks", () => {
  it("turns the letter into headings, paragraphs and the place of the fee table", () => {
    const html = '<h1>Offer of Admission</h1><p><strong>OFFER LETTER: Lesedi Aimark</strong></p><p>Dear <strong>Kagiso</strong>, welcome.</p><table class="details"><tr><td>Application fee</td><td>P 300.00</td></tr></table><p><strong>Account details:</strong> Bank: FNB · Account number: 1</p><p>Kind regards,<br>Admissions</p>';
    expect(htmlToBlocks(html, { dropLeadingHeading: "Offer of Admission" })).toEqual([
      { kind: "heading", text: "OFFER LETTER: Lesedi Aimark" },
      { kind: "para", text: "Dear Kagiso, welcome." },
      { kind: "fees", text: "" },
      { kind: "bank", text: "Account details: Bank: FNB · Account number: 1" },
      { kind: "para", text: "Kind regards," },
      { kind: "para", text: "Admissions" },
    ]);
    expect(htmlToParagraphs(html)).toEqual(["Offer of Admission", "OFFER LETTER: Lesedi Aimark", "Dear Kagiso, welcome.", "Account details: Bank: FNB · Account number: 1", "Kind regards,", "Admissions"]);
  });
});

describe("withSignatory", () => {
  const blocks = [
    { kind: "para", text: "We look forward to welcoming Kabelo." },
    { kind: "para", text: "Kind regards, Admissions, Hibiscus International Schools" },
  ];
  it("drops the template's closing line when a signatory is known", () => {
    const r = withSignatory(blocks, { name: "T. Modise", title: "Head of School", imageDataUrl: null });
    expect(r.sign).toBe(true);
    expect(r.blocks).toHaveLength(1);
  });
  it("leaves the letter alone when nobody signs it", () => {
    const r = withSignatory(blocks, { name: null, title: null, imageDataUrl: null });
    expect(r.sign).toBe(false);
    expect(r.blocks).toHaveLength(2);
  });
  it("keeps a last paragraph that is not a closing", () => {
    const r = withSignatory(blocks.slice(0, 1), { name: "T. Modise", title: null, imageDataUrl: null });
    expect(r.blocks).toHaveLength(1);
    expect(r.sign).toBe(true);
  });
});
