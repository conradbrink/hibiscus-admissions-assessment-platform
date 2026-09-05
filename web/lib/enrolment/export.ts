import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";

/**
 * The student export: columns are configuration (a path into the snapshot,
 * a header, a transform), rows are enrolment snapshots. Pure and tested;
 * the route that serves the file records the batch.
 */

export type ExportTransform = "none" | "upper" | "date_dmy" | "date_ymd" | "yes_no" | "money";

export type ExportColumn = {
  header: string;
  source_path: string;
  transform: ExportTransform;
};

/** `guardians[0].mobile` → the value, or null when any step is missing. Never throws on a bad path. */
export function resolvePath(snapshot: unknown, path: string): unknown {
  let cur: unknown = snapshot;
  for (const step of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    const m = /^([a-z_]+)(?:\[(\d+)\])?$/.exec(step);
    if (!m) return null;
    if (typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, m[1])) return null;
    cur = (cur as Record<string, unknown>)[m[1]];
    if (m[2] !== undefined) {
      cur = Array.isArray(cur) ? cur[Number(m[2])] : null;
    }
  }
  return cur ?? null;
}

export function applyTransform(value: unknown, transform: ExportTransform): string {
  if (value === null || value === undefined) return "";
  switch (transform) {
    case "upper":
      return String(value).toUpperCase();
    case "date_dmy": {
      const s = String(value).slice(0, 10);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
    }
    case "date_ymd":
      return String(value).slice(0, 10);
    case "yes_no":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "money": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? (n / 100).toFixed(2) : "";
    }
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

export function renderRow(snapshot: StudentRecordSnapshot | unknown, columns: ExportColumn[]): string[] {
  return columns.map((c) => applyTransform(resolvePath(snapshot, c.source_path), c.transform));
}

export function renderRows(snapshots: unknown[], columns: ExportColumn[]): string[][] {
  return snapshots.map((s) => renderRow(s, columns));
}

function csvCell(v: string): string {
  // RFC 4180: quote when needed, double the quotes. A leading =, +, -, @ is
  // prefixed so a spreadsheet never runs it as a formula.
  const guarded = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** UTF-8 with a byte-order mark and CRLF line ends, which is what Excel opens correctly. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function toJson(headers: string[], rows: string[][]): string {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]))),
    null,
    2
  );
}

export function exportFilename(format: "csv" | "json", when: Date, campusCode: string | null): string {
  const stamp = when.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `hibiscus-students-${campusCode ?? "all"}-${stamp}.${format}`;
}

/** Paths under `medical.` leave the system only when an administrator turned that column on. */
export function isMedicalPath(path: string): boolean {
  return path.startsWith("medical.");
}
