/**
 * Report cells, made safe to open in a spreadsheet. A text cell that starts
 * with `=`, `+`, `-`, `@`, a tab or a carriage return is run as a formula by
 * Excel and Google Sheets, and an item name or a note is whatever somebody
 * typed. Such a cell gets a leading apostrophe, which the spreadsheet shows
 * as text. Numbers are left alone so a negative quantity is still a number.
 * Pure; tested.
 */
export type Cell = string | number | null;

export function safeCell(c: Cell): string | number | null {
  if (typeof c === "string" && /^[=+\-@\t\r]/.test(c)) return `'${c}`;
  return c;
}

export function csvCell(c: Cell): string {
  const v = safeCell(c);
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV a spreadsheet opens as UTF-8: a byte-order mark, CRLF lines, every cell escaped. */
export function toSafeCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<Cell>>): string {
  return "﻿" + [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
