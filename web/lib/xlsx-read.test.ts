import { describe, expect, it } from "vitest";
import { buildWorkbook, zipEntries } from "@/lib/enrolment/xlsx";
import { deflateRawSync } from "node:zlib";
import { columnIndex, looksLikeWorkbook, MAX_PART_BYTES, readWorkbook, serialToIsoDate, unzip } from "@/lib/xlsx-read";

/** A workbook the way Excel writes one: shared strings, a date-styled number, a formula's cached value. */
function excelStyleWorkbook(): Buffer {
  const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`, "utf8");
  return zipEntries([
    { name: "[Content_Types].xml", data: xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`) },
    { name: "_rels/.rels", data: xml(`<Relationships/>`) },
    {
      name: "xl/workbook.xml",
      data: xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Students &amp; co" sheetId="1" r:id="rId7"/><sheet name="Empty" sheetId="2" r:id="rId8"/></sheets></workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xml(`<Relationships><Relationship Id="rId8" Type="w" Target="worksheets/sheet2.xml"/><Relationship Id="rId7" Type="w" Target="/xl/worksheets/sheet1.xml"/></Relationships>`),
    },
    {
      name: "xl/sharedStrings.xml",
      data: xml(`<sst count="3" uniqueCount="3"><si><t>Family Code*</t></si><si><r><t>Date of </t></r><r><t xml:space="preserve">Birth*</t></r></si><si><t>O&apos;Neil</t></si></sst>`),
    },
    {
      name: "xl/styles.xml",
      data: xml(`<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="2"/></cellXfs></styleSheet>`),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: xml(
        `<worksheet><sheetData>` +
          `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Surname</t></is></c><c r="D1" t="str"><v>Cell</v></c></row>` +
          `<row r="2"><c r="A2" t="inlineStr"><is><t>COE0001</t></is></c><c r="B2" s="1"><v>44927</v></c><c r="C2" t="s"><v>2</v></c><c r="D2" s="3"><v>71234567</v></c></row>` +
          `<row r="3"><c r="A3"><v>7</v></c><c r="B3" s="2"><v>45927.5</v></c><c r="D3" t="b"><v>1</v></c></row>` +
          `<row r="4"/>` +
          `</sheetData></worksheet>`
      ),
    },
    { name: "xl/worksheets/sheet2.xml", data: xml(`<worksheet><sheetData/></worksheet>`) },
  ]);
}

describe("readWorkbook", () => {
  it("round-trips a workbook written by the export writer", () => {
    const file = buildWorkbook([
      { name: "Basic", headers: ["Family/Sponsor Code*", "G1 Last Name*"], rows: [["COE0001", "Coetzer"], ["VAN0002", "van der Merwe, \"Piet\" & <co>"]] },
      { name: "G1 Contact", headers: ["Family/SponsorCode*", "G1 Cell"], rows: [["COE0001", "071234567"]] },
    ]);
    expect(looksLikeWorkbook(file)).toBe(true);
    const sheets = readWorkbook(file);
    expect(sheets.map((s) => s.name)).toEqual(["Basic", "G1 Contact"]);
    expect(sheets[0].rows).toEqual([
      ["Family/Sponsor Code*", "G1 Last Name*"],
      ["COE0001", "Coetzer"],
      ["VAN0002", 'van der Merwe, "Piet" & <co>'],
    ]);
    expect(sheets[1].rows[1]).toEqual(["COE0001", "071234567"]);
  });

  it("reads shared strings, rich text, a date-styled number, a plain number and a boolean", () => {
    const sheets = readWorkbook(excelStyleWorkbook());
    expect(sheets.map((s) => s.name)).toEqual(["Students & co", "Empty"]);
    const [header, row2, row3, row4] = sheets[0].rows;
    expect(header).toEqual(["Family Code*", "Date of Birth*", "Surname", "Cell"]);
    expect(row2).toEqual(["COE0001", "2023-01-01", "O'Neil", "71234567"]);
    // A gap (no C3) stays a gap; a date with a time keeps only the day.
    expect(row3).toEqual(["7", "2025-09-27", "", "TRUE"]);
    expect(row4).toEqual([]);
    expect(sheets[1].rows).toEqual([]);
  });

  it("refuses something that is not a workbook", () => {
    expect(() => readWorkbook(Buffer.from("first_name,last_name\nAnna,Brink\n"))).toThrow(/not a workbook/);
    expect(looksLikeWorkbook(Buffer.from("first_name,last_name"))).toBe(false);
  });

  it("refuses a part that claims, or would inflate to, more than the cap", () => {
    const file = buildWorkbook([{ name: "S", headers: ["a"], rows: [["b"]] }]);
    // The central directory's uncompressed-size field for the first entry.
    const central = file.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const lying = Buffer.from(file);
    lying.writeUInt32LE(MAX_PART_BYTES + 1, central + 24);
    expect(() => unzip(lying)).toThrow(/too large/);

    // A stream of zeros compresses a thousandfold; the header claims a small
    // size, so only the inflater's own limit can stop it.
    const bomb = deflateRawSync(Buffer.alloc(MAX_PART_BYTES + 1024));
    const zipped = zipEntries([{ name: "xl/workbook.xml", data: Buffer.alloc(MAX_PART_BYTES + 1024) }]);
    const bombCentral = zipped.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zipped.writeUInt32LE(16, bombCentral + 24);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => unzip(zipped)).toThrow();
  });

  it("unzips what the writer zipped, byte for byte", () => {
    const parts = unzip(buildWorkbook([{ name: "S", headers: ["a"], rows: [["b"]] }]));
    expect([...parts.keys()]).toContain("xl/worksheets/sheet1.xml");
    expect(parts.get("xl/worksheets/sheet1.xml")?.toString("utf8")).toContain("<t xml:space=\"preserve\">b</t>");
  });
});

describe("helpers", () => {
  it("turns Excel's day count into a date", () => {
    expect(serialToIsoDate(25569)).toBe("1970-01-01");
    expect(serialToIsoDate(44927)).toBe("2023-01-01");
    expect(serialToIsoDate(0)).toBeNull();
  });
  it("reads column letters", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("AB12")).toBe(27);
  });
});
