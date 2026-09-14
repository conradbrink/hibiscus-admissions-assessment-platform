import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToBlocks, withSignatory, htmlToParagraphs } from "@/lib/documents/offer-pdf";

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

describe("decodeEntities", () => {
  it("decodes the separator that printed literally on every letterhead", () => {
    // "Hibiscus International Schools &middot; Phase 2" is what the PDF showed
    // for months: the converter knew six entities by name and this was not one.
    expect(decodeEntities("Hibiscus International Schools &middot; Phase 2")).toBe("Hibiscus International Schools · Phase 2");
  });

  it("does not walk over its own output", () => {
    // The old chain replaced &amp; first and then met the &middot; it had just
    // produced. One pass means escaped text stays escaped.
    expect(decodeEntities("&amp;middot;")).toBe("&middot;");
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
  });

  it("handles the punctuation a letter is actually written with", () => {
    expect(decodeEntities("don&rsquo;t &mdash; really&hellip;")).toBe("don\u2019t — really…");
  });

  it("handles numeric forms in both bases", () => {
    expect(decodeEntities("&#183;&#xB7;")).toBe("··");
  });

  it("leaves anything it does not know standing, rather than swallowing it", () => {
    // A reader can report "&frac12;"; a silently deleted character is invisible.
    expect(decodeEntities("half &frac12; of it")).toBe("half &frac12; of it");
  });

  it("carries through the letter converter", () => {
    expect(htmlToParagraphs("<p>Hibiscus International Schools &middot; Phase 2</p>")).toEqual([
      "Hibiscus International Schools · Phase 2",
    ]);
  });
});
