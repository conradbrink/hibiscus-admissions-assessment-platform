import { normaliseEmail, normaliseMobile, tidyName } from "@/lib/contacts";
import { HEARD_FROM_KEYS } from "@/lib/heard-from";

/**
 * Reading a spreadsheet of families or parents, and saying what is wrong
 * with it before a single row is written.
 *
 * A small CSV reader (quotes, escaped quotes, CR/LF, a BOM) rather than a
 * dependency, because the shape is fixed and the failure modes are the
 * interesting part: a header nobody expected, an email that is not one, two
 * rows with the same number, a campus the school does not have. Pure and
 * tested; the import itself is in `import.ts`.
 */

export type CsvTable = { headers: string[]; rows: string[][] };

export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return { headers, rows: nonEmpty };
}

/** The columns an import may carry. Anything else is ignored and reported. */
export const FAMILY_COLUMNS = [
  "family_name", "first_name", "last_name", "email", "mobile", "relationship", "campus",
  "lead_source", "address", "language", "preferred_channel", "tags", "notes",
  "marketing_email", "marketing_whatsapp", "sms", "whatsapp_updates",
] as const;

export type FamilyColumn = (typeof FAMILY_COLUMNS)[number];

/** Alternative spellings a spreadsheet is likely to use. */
const ALIASES: Record<string, FamilyColumn> = {
  surname: "last_name",
  family: "family_name",
  familyname: "family_name",
  parent_first_name: "first_name",
  parent_last_name: "last_name",
  parent_surname: "last_name",
  firstname: "first_name",
  lastname: "last_name",
  name: "first_name",
  email_address: "email",
  e_mail: "email",
  phone: "mobile",
  cell: "mobile",
  cellphone: "mobile",
  mobile_number: "mobile",
  whatsapp: "mobile",
  whatsapp_number: "mobile",
  source: "lead_source",
  heard_from: "lead_source",
  home_address: "address",
  home_language: "language",
  preferred_language: "language",
  channel: "preferred_channel",
  email_consent: "marketing_email",
  whatsapp_consent: "marketing_whatsapp",
  sms_consent: "sms",
  whatsapp_opt_in: "whatsapp_updates",
};

export function mapHeaders(headers: readonly string[]): { map: Array<FamilyColumn | null>; unknown: string[]; missing: FamilyColumn[] } {
  const map = headers.map((h) => {
    if ((FAMILY_COLUMNS as readonly string[]).includes(h)) return h as FamilyColumn;
    return ALIASES[h] ?? null;
  });
  const unknown = headers.filter((_, i) => map[i] === null);
  const present = new Set(map.filter((m): m is FamilyColumn => m !== null));
  const missing = (["first_name", "last_name", "email"] as const).filter((c) => !present.has(c));
  return { map, unknown, missing };
}

export type ImportRecord = {
  family_name: string | null;
  first_name: string;
  last_name: string;
  email: string;
  email_normalised: string;
  mobile: string | null;
  mobile_normalised: string | null;
  relationship: "mother" | "father" | "parent" | "guardian" | "grandparent" | "other";
  campus: string | null;
  lead_source: string | null;
  address: string | null;
  language: string | null;
  preferred_channel: "email" | "whatsapp" | "phone" | "sms" | null;
  tags: string[];
  notes: string | null;
  marketing_email: boolean;
  marketing_whatsapp: boolean;
  sms: boolean;
  whatsapp_updates: boolean;
};

export type RowVerdict =
  | { ok: true; record: ImportRecord; warnings: string[] }
  | { ok: false; errors: string[] };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YES = /^(y|yes|true|1|x)$/i;
const RELATIONSHIPS = ["mother", "father", "parent", "guardian", "grandparent", "other"] as const;
const CHANNELS = ["email", "whatsapp", "phone", "sms"] as const;

export function validateRow(headers: Array<FamilyColumn | null>, cells: readonly string[], campusCodes: ReadonlySet<string>): RowVerdict {
  const get = (col: FamilyColumn): string => {
    const i = headers.indexOf(col);
    return i >= 0 ? (cells[i] ?? "").trim() : "";
  };
  const errors: string[] = [];
  const warnings: string[] = [];

  const first = tidyName(get("first_name"));
  const last = tidyName(get("last_name"));
  const email = get("email");
  if (!first) errors.push("First name is missing.");
  if (!last) errors.push("Last name is missing.");
  if (!email) errors.push("Email is missing.");
  else if (!EMAIL_SHAPE.test(email)) errors.push(`"${email}" is not an email address.`);

  const mobileRaw = get("mobile");
  const mobile = mobileRaw ? normaliseMobile(mobileRaw) : null;
  if (mobileRaw && !mobile) warnings.push(`Mobile "${mobileRaw}" could not be read as a Botswana or South African number; kept as typed, WhatsApp will not reach it.`);

  const campusRaw = get("campus").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  let campus: string | null = null;
  if (campusRaw) {
    if (campusCodes.has(campusRaw)) campus = campusRaw;
    else errors.push(`Campus "${get("campus")}" is not one of the school's campuses.`);
  }

  const relRaw = get("relationship").toLowerCase();
  const relationship = (RELATIONSHIPS as readonly string[]).includes(relRaw) ? (relRaw as ImportRecord["relationship"]) : "parent";
  if (relRaw && relationship !== relRaw) warnings.push(`Relationship "${get("relationship")}" is not recognised; recorded as parent.`);

  const sourceRaw = get("lead_source").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  let lead_source: string | null = null;
  if (sourceRaw) {
    if ((HEARD_FROM_KEYS as readonly string[]).includes(sourceRaw)) lead_source = sourceRaw;
    else {
      lead_source = "other";
      warnings.push(`Lead source "${get("lead_source")}" is not one of the known sources; recorded as "other".`);
    }
  }

  const channelRaw = get("preferred_channel").toLowerCase();
  const preferred_channel = (CHANNELS as readonly string[]).includes(channelRaw) ? (channelRaw as ImportRecord["preferred_channel"]) : null;

  const tags = get("tags")
    .split(/[;,|]/)
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    record: {
      family_name: get("family_name") ? tidyName(get("family_name")) : null,
      first_name: first,
      last_name: last,
      email,
      email_normalised: normaliseEmail(email),
      mobile: mobileRaw || null,
      mobile_normalised: mobile,
      relationship,
      campus,
      lead_source,
      address: get("address") || null,
      language: get("language") || null,
      preferred_channel,
      tags,
      notes: get("notes") || null,
      marketing_email: YES.test(get("marketing_email")),
      marketing_whatsapp: YES.test(get("marketing_whatsapp")),
      sms: YES.test(get("sms")),
      whatsapp_updates: YES.test(get("whatsapp_updates")),
    },
  };
}

/** Rows that repeat an email or a number already seen earlier in the same file. */
export function duplicatesWithinFile(records: ReadonlyArray<{ index: number; record: ImportRecord }>): Map<number, string> {
  const seenEmail = new Map<string, number>();
  const seenMobile = new Map<string, number>();
  const out = new Map<number, string>();
  for (const { index, record } of records) {
    const e = seenEmail.get(record.email_normalised);
    if (e !== undefined) {
      out.set(index, `Same email as row ${e + 1}.`);
      continue;
    }
    seenEmail.set(record.email_normalised, index);
    if (record.mobile_normalised) {
      const m = seenMobile.get(record.mobile_normalised);
      if (m !== undefined) {
        out.set(index, `Same mobile number as row ${m + 1}.`);
        continue;
      }
      seenMobile.set(record.mobile_normalised, index);
    }
  }
  return out;
}

/** A CSV line, quoted where a cell needs it. */
export function csvLine(cells: ReadonlyArray<string | number | boolean | null | undefined>): string {
  return cells
    .map((c) => {
      const s = c === null || c === undefined ? "" : String(c);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return [csvLine(headers), ...rows.map(csvLine)].join("\r\n") + "\r\n";
}
