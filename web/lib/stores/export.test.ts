import { describe, expect, it } from "vitest";
import { csvCell, safeCell, toSafeCsv } from "@/lib/stores/export";

describe("safe spreadsheet cells", () => {
  it("defuses a formula typed into a name or a note", () => {
    expect(safeCell('=HYPERLINK("https://x.example","click")')).toBe('\'=HYPERLINK("https://x.example","click")');
    expect(safeCell("+27 71 000 0000")).toBe("'+27 71 000 0000");
    expect(safeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCell("-1 for the stock take")).toBe("'-1 for the stock take");
  });
  it("leaves numbers and ordinary text alone", () => {
    expect(safeCell(-3)).toBe(-3);
    expect(safeCell("Floor Cleaner")).toBe("Floor Cleaner");
    expect(safeCell(null)).toBeNull();
  });
  it("still quotes commas, quotes and line breaks, after defusing", () => {
    expect(csvCell('=A1,"x"')).toBe('"\'=A1,""x"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
  it("writes a byte-order mark and CRLF lines", () => {
    const csv = toSafeCsv(["Item", "Qty"], [["Ball", 5]]);
    expect(csv.startsWith("﻿Item,Qty\r\n")).toBe(true);
    expect(csv.endsWith("Ball,5\r\n")).toBe(true);
  });
});
