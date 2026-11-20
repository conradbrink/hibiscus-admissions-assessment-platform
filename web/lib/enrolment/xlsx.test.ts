import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "@/lib/enrolment/xlsx";

/** The first sheet's XML, read straight out of the zip's local entry. */
function sheetOne(book: Buffer): string {
  const name = "xl/worksheets/sheet1.xml";
  const at = book.indexOf(name);
  const compressed = book.readUInt32LE(at - 30 + 18);
  return inflateRawSync(book.subarray(at + name.length, at + name.length + compressed)).toString("utf8");
}

describe("buildWorkbook", () => {
  it("writes a number as a number, so a spreadsheet can add the column up", () => {
    const xml = sheetOne(buildWorkbook([{ name: "S", headers: ["Item", "Change"], rows: [["Paper", -2], ["Chalk", 12.5]] }]));
    expect(xml).toContain('<c r="B2"><v>-2</v></c>');
    expect(xml).toContain('<c r="B3"><v>12.5</v></c>');
  });

  it("keeps text as text, a leading zero and a would-be formula included", () => {
    const xml = sheetOne(buildWorkbook([{ name: "S", headers: ["A"], rows: [["0712345678"], ["=SUM(A1)"]] }]));
    expect(xml).toContain('t="inlineStr"><is><t xml:space="preserve">0712345678</t>');
    expect(xml).toContain('t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t>');
  });

  it("leaves a cell out rather than write a number that is not one", () => {
    const xml = sheetOne(buildWorkbook([{ name: "S", headers: ["A", "B"], rows: [[Number.NaN, "x"]] }]));
    expect(xml).not.toContain('r="A2"');
    expect(xml).toContain('r="B2"');
  });
});
