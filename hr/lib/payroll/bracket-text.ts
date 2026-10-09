import type { Bracket } from "@/lib/payroll/tax-table";

/**
 * Tax brackets as a payroll officer reads them in a published table, one per
 * line, in whole currency units:
 *
 *   from, to, tax on "from", rate
 *   0, 245100, 0, 18%
 *   1878600, , 666339, 45%
 *
 * A blank "to" is the open top bracket. Commas inside numbers are not
 * allowed (they separate the columns); spaces are ignored.
 */

const toMinor = (s: string) => Math.round(Number(s) * 100);

export function parseBracketText(text: string): { brackets: Bracket[] } | { error: string } {
  const brackets: Bracket[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return { error: "enter at least one bracket" };
  for (const [i, line] of lines.entries()) {
    const cols = line.split(",").map((c) => c.replace(/\s+/g, ""));
    if (cols.length !== 4) return { error: `line ${i + 1} needs four columns: from, to, tax on "from", rate` };
    const [from, to, base, rateText] = cols;
    const rate = rateText.endsWith("%") ? Number(rateText.slice(0, -1)) / 100 : Number(rateText);
    if ([from, base].some((v) => v === "" || !Number.isFinite(Number(v))) || (to !== "" && !Number.isFinite(Number(to))) || !Number.isFinite(rate)) {
      return { error: `line ${i + 1} has something that is not a number` };
    }
    brackets.push({ lowerMinor: toMinor(from), upperMinor: to === "" ? null : toMinor(to), baseTaxMinor: toMinor(base), rate: Math.round(rate * 10000) / 10000 });
  }
  return { brackets };
}

export function formatBracketText(brackets: readonly Bracket[]): string {
  const major = (n: number) => String(n / 100);
  return [...brackets]
    .sort((a, b) => a.lowerMinor - b.lowerMinor)
    .map((b) => `${major(b.lowerMinor)}, ${b.upperMinor === null ? "" : major(b.upperMinor)}, ${major(b.baseTaxMinor)}, ${Math.round(b.rate * 10000) / 100}%`)
    .join("\n");
}
