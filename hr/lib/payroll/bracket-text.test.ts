import { describe, expect, it } from "vitest";
import { formatBracketText, parseBracketText } from "@/lib/payroll/bracket-text";
import { validateBrackets } from "@/lib/payroll/tax-table";

describe("bracket text", () => {
  const text = "0, 48000, 0, 0%\n48000, 84000, 0, 5%\n84000, 120000, 1800, 12.5%\n120000, , 6300, 18.75%";

  it("reads a table typed from a published schedule", () => {
    const parsed = parseBracketText(text);
    expect("brackets" in parsed && parsed.brackets).toEqual([
      { lowerMinor: 0, upperMinor: 4800000, baseTaxMinor: 0, rate: 0 },
      { lowerMinor: 4800000, upperMinor: 8400000, baseTaxMinor: 0, rate: 0.05 },
      { lowerMinor: 8400000, upperMinor: 12000000, baseTaxMinor: 180000, rate: 0.125 },
      { lowerMinor: 12000000, upperMinor: null, baseTaxMinor: 630000, rate: 0.1875 },
    ]);
    if ("brackets" in parsed) expect(validateBrackets(parsed.brackets)).toBeNull();
  });

  it("round-trips", () => {
    const parsed = parseBracketText(text);
    if (!("brackets" in parsed)) throw new Error("parse failed");
    expect(formatBracketText(parsed.brackets)).toBe(text);
  });

  it("names the line that is wrong", () => {
    expect(parseBracketText("0, 48000, 0\n")).toEqual({ error: 'line 1 needs four columns: from, to, tax on "from", rate' });
    expect(parseBracketText("0, 48000, 0, 0%\n48000, abc, 0, 5%")).toEqual({ error: "line 2 has something that is not a number" });
    expect(parseBracketText("  \n")).toEqual({ error: "enter at least one bracket" });
  });
});
