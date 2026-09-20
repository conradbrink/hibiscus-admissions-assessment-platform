import { inflateRawSync } from "node:zlib";

/**
 * A very small .xlsx reader: the other half of `lib/enrolment/xlsx.ts`.
 *
 * The school's other system hands its records out as workbooks, and the
 * CRM's import reads them. Rather than add a spreadsheet library for the
 * handful of things a records export contains, this unpacks the zip, reads
 * the sheet list, the shared strings and each sheet's cells, and gives back
 * text. Every cell comes back as a string: a family code, a phone number
 * with a leading zero and an ID number are text whatever Excel decided, and
 * a date cell is turned back into `YYYY-MM-DD` from Excel's day count so the
 * importer never sees `45927`.
 *
 * Not covered, on purpose: formulas are read by their cached value, merged
 * cells by their top-left cell, and the old binary `.xls` format not at all
 * (it is not a zip of XML; Excel saves it as .xlsx in one step).
 */

export type ReadSheet = { name: string; rows: string[][] };

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/**
 * How big one unpacked part may be. A records export of a few thousand rows
 * is a few megabytes of XML; a part claiming more than this is not a
 * workbook anyone made in Excel, and a deflate stream that would inflate
 * past it is stopped at the limit rather than in memory.
 */
export const MAX_PART_BYTES = 64 * 1024 * 1024;
/** And all of them together. */
export const MAX_WORKBOOK_BYTES = 128 * 1024 * 1024;

/** The members of a zip, by name. Stored and deflated entries only, which is all a workbook uses. */
export function unzip(file: Buffer): Map<string, Buffer> {
  if (file.length < 22) throw new Error("This is not a workbook.");
  let end = -1;
  for (let i = file.length - 22; i >= Math.max(0, file.length - 22 - 65_536); i--) {
    if (file.readUInt32LE(i) === END_OF_CENTRAL) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This is not a workbook.");
  const count = file.readUInt16LE(end + 10);
  let p = file.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > file.length || file.readUInt32LE(p) !== CENTRAL_HEADER) throw new Error("This workbook is damaged.");
    const method = file.readUInt16LE(p + 10);
    const compressed = file.readUInt32LE(p + 20);
    const uncompressed = file.readUInt32LE(p + 24);
    const nameLen = file.readUInt16LE(p + 28);
    const extraLen = file.readUInt16LE(p + 30);
    const commentLen = file.readUInt16LE(p + 32);
    const offset = file.readUInt32LE(p + 42);
    const name = file.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    total += uncompressed;
    if (uncompressed > MAX_PART_BYTES || total > MAX_WORKBOOK_BYTES) throw new Error(`Part "${name}" is too large for this reader.`);

    if (offset + 30 > file.length || file.readUInt32LE(offset) !== LOCAL_HEADER) throw new Error("This workbook is damaged.");
    const localName = file.readUInt16LE(offset + 26);
    const localExtra = file.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const data = file.subarray(start, start + compressed);
    if (method === 0) out.set(name, Buffer.from(data));
    // The header's own size claim is checked above; this is the limit that
    // holds when the claim lies.
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }));
    else throw new Error(`Part "${name}" is compressed in a way this reader does not know.`);
  }
  return out;
}

function unescape(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

/** Every `<t>` inside an element, joined: a rich-text run is several. */
function textOf(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] ? unescape(m[1]) : "";
  return out;
}

function sharedStrings(parts: Map<string, Buffer>): string[] {
  const xml = parts.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] ? textOf(m[1]) : "");
  return out;
}

/** Excel's built-in date formats, and any custom one that spells out a day, month or year. */
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Which cell styles (by index) are dates. */
function dateStyles(parts: Map<string, Buffer>): Set<number> {
  const xml = parts.get("xl/styles.xml")?.toString("utf8");
  const out = new Set<number>();
  if (!xml) return out;
  const custom = new Set<number>();
  const fmtRe = /<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = fmtRe.exec(xml))) {
    // Strip quoted literals and colour tags, then look for a day, month or
    // year token. "0.00" is not a date; "dd/mm/yyyy" and "[$-409]d-mmm" are.
    const code = unescape(m[2]).replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    if (/[dmy]/i.test(code) && !/^[#0,.\s%E+-]*$/.test(code)) custom.add(Number(m[1]));
  }
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  const xfRe = /<xf\s[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
  let i = 0;
  while ((m = xfRe.exec(xfs))) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? "0");
    if (BUILT_IN_DATES.has(id) || custom.has(id)) out.add(i);
    i++;
  }
  return out;
}

/** Excel's day count (1900 system) as YYYY-MM-DD. The time of day is dropped. */
export function serialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  // 25569 is 1 January 1970. Excel's 1900 leap-year bug sits below 61 and
  // never affects a birth date after 1900, so it is left alone.
  const ms = Math.round((Math.floor(serial) - 25569) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** A1 → 0, B1 → 1, AA1 → 26. */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRows(xml: string, strings: string[], dates: Set<number>): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const cells: string[] = [];
    const body = rm[1] ?? "";
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(body))) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "";
      const col = ref ? columnIndex(ref) : cells.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? "-1");
      let value = "";
      if (type === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
        value = strings[Number(v)] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(inner);
      } else if (type === "str" || type === "e") {
        value = unescape(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      } else if (type === "b") {
        value = (/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "") === "1" ? "TRUE" : "FALSE";
      } else {
        const raw = unescape(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
        if (raw !== "" && dates.has(style)) value = serialToIsoDate(Number(raw)) ?? raw;
        else if (raw !== "" && /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(raw)) {
          // A number as a person would write it: 71234567, not 7.1234567E7.
          const n = Number(raw);
          value = Number.isInteger(n) && Math.abs(n) < 1e15 ? String(n) : raw;
        } else value = raw;
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** The sheets of a workbook, in their tab order, every cell as text. */
export function readWorkbook(file: Buffer): ReadSheet[] {
  const parts = unzip(file);
  const workbook = parts.get("xl/workbook.xml")?.toString("utf8");
  if (!workbook) throw new Error("This is not a workbook: it has no sheet list.");
  const rels = parts.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targets = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*?\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(rels))) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const strings = sharedStrings(parts);
  const dates = dateStyles(parts);
  const sheets: ReadSheet[] = [];
  const sheetRe = /<sheet\b[^>]*?\/?>/g;
  let i = 0;
  while ((m = sheetRe.exec(workbook))) {
    const name = unescape(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? `Sheet${i + 1}`);
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const part = targets.get(rid) ?? `xl/worksheets/sheet${i + 1}.xml`;
    const xml = parts.get(part)?.toString("utf8");
    if (xml !== undefined) sheets.push({ name, rows: sheetRows(xml, strings, dates) });
    i++;
  }
  if (!sheets.length) throw new Error("This workbook has no sheets.");
  return sheets;
}

/** True when the bytes are a zip, which is what an .xlsx is; a CSV is not. */
export function looksLikeWorkbook(file: Buffer): boolean {
  return file.length > 4 && file.readUInt32LE(0) === LOCAL_HEADER;
}
