import { describe, expect, it } from "vitest";
import { buildWorkbook, workbookParts, type Sheet } from "@/lib/enrolment/xlsx";
import { readWorkbook, unzip } from "@/lib/xlsx-read";

const text = (parts: Array<{ name: string; data: Buffer }>, name: string) => parts.find((p) => p.name === name)?.data.toString("utf8") ?? "";

describe("buildWorkbook", () => {
  it("leaves a text-only workbook exactly as it was: no styles part, no views, no widths", () => {
    const parts = workbookParts([{ name: "Basic", headers: ["Code", "Cell"], rows: [["COE0001", "071234567"]] }]);
    expect(parts.map((p) => p.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(text(parts, "xl/worksheets/sheet1.xml")).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">Code</t></is></c><c r="B1" t="inlineStr"><is><t xml:space="preserve">Cell</t></is></c></row>` +
        `<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">COE0001</t></is></c><c r="B2" t="inlineStr"><is><t xml:space="preserve">071234567</t></is></c></row>` +
        `</sheetData></worksheet>`
    );
  });

  it("writes a number as a number and keeps a phone number given as text as text", () => {
    const file = buildWorkbook([{ name: "Counts", headers: ["Area", "Children", "Mobile"], rows: [["Phakalane", 12, "071234567"]] }]);
    const sheet = unzip(file).get("xl/worksheets/sheet1.xml")!.toString("utf8");
    expect(sheet).toContain(`<c r="B2"><v>12</v></c>`);
    expect(sheet).toContain(`<c r="C2" t="inlineStr"><is><t xml:space="preserve">071234567</t></is></c>`);
    expect(readWorkbook(file)[0].rows).toEqual([
      ["Area", "Children", "Mobile"],
      ["Phakalane", "12", "071234567"],
    ]);
  });

  it("adds widths, formats, a bold header and a frozen row only for the sheet that asks, and a styles part once", () => {
    const report: Sheet = {
      name: "Summary",
      headers: ["What", "Amount", "Children"],
      rows: [
        ["Paid by parents", 12900, 3],
        ["Refunded", "-", 0],
      ],
      columns: [{ width: 30 }, { width: 14, format: "money" }, { format: "count" }],
      freezeHeader: true,
    };
    const plain: Sheet = { name: "About", headers: ["Note"], rows: [["Taken on 18 Oct 2026"]] };
    const parts = workbookParts([report, plain]);

    expect(parts.filter((p) => p.name === "xl/styles.xml")).toHaveLength(1);
    expect(text(parts, "[Content_Types].xml")).toContain(`PartName="/xl/styles.xml"`);
    expect(text(parts, "xl/_rels/workbook.xml.rels")).toContain(`Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"`);

    const s1 = text(parts, "xl/worksheets/sheet1.xml");
    expect(s1).toContain(`<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`);
    expect(s1).toContain(`<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/></cols>`);
    // The views come before the widths, and both before the data: Excel refuses another order.
    expect(s1.indexOf("<sheetViews>")).toBeLessThan(s1.indexOf("<cols>"));
    expect(s1.indexOf("<cols>")).toBeLessThan(s1.indexOf("<sheetData>"));
    expect(s1).toContain(`<c r="A1" s="3" t="inlineStr">`);
    expect(s1).toContain(`<c r="B2" s="1"><v>12900</v></c>`);
    expect(s1).toContain(`<c r="C2" s="2"><v>3</v></c>`);
    // A dash in a money column is text, not a formatted number.
    expect(s1).toContain(`<c r="B3" t="inlineStr"><is><t xml:space="preserve">-</t></is></c>`);

    const s2 = text(parts, "xl/worksheets/sheet2.xml");
    expect(s2).not.toContain("<sheetViews>");
    expect(s2).not.toContain(` s="`);

    const read = readWorkbook(buildWorkbook([report, plain]));
    expect(read[0].rows[1]).toEqual(["Paid by parents", "12900", "3"]);
    expect(read[1].rows[1]).toEqual(["Taken on 18 Oct 2026"]);
  });

  it("writes an amount in pula with its decimals as given", () => {
    const sheet = text(workbookParts([{ name: "Lines", headers: ["Amount"], rows: [[4481.57], [0.1]], columns: [{ format: "money" }] }]), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain(`<v>4481.57</v>`);
    expect(sheet).toContain(`<v>0.1</v>`);
  });

  it("refuses a number that is not finite, and more column settings than columns", () => {
    expect(() => buildWorkbook([{ name: "Bad", headers: ["N"], rows: [[Number.NaN]] }])).toThrow(/not a finite number/);
    expect(() => buildWorkbook([{ name: "Bad", headers: ["N"], rows: [[1]], columns: [{}, {}] }])).toThrow(/column settings/);
  });
});
