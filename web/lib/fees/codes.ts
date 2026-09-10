import { parseMoneyToMinor } from "@/lib/money";
import type { FeeCode } from "@/lib/supabase/types";

/**
 * The fee vocabulary, in one place.
 *
 * It used to be in five: the database check constraint, a constant in the
 * fees admin, the `FeeCode` union, the offer letter's variable map, and the
 * template editor's sample values. They drifted, and the drift did damage.
 * `stationery_annual` was added to the database in September and reached
 * none of the others, so Bana Tlokweng's stationery fees rendered as an
 * editable field whose edits were thrown away on save.
 *
 * Worse, the admin's constant was what the save loop iterated — not the
 * lines the schedule actually had — so saving a schedule with one fee wrote
 * five, four of them zero. The parent's offer page and the offer PDF print
 * every line, so a preschool letter was one click away from quoting
 * "Tuition per term P 0.00".
 *
 * So this list is the vocabulary now, and the order here is the order fees
 * appear on a schedule and in a letter: what is paid to hold the place
 * first, then what is paid to attend.
 */
export const FEE_CODES = [
  "registration",
  "admission",
  "tuition_month",
  "tuition_term",
  "tuition_annual",
  "stationery_annual",
] as const;

/** What a new line of each kind is called and when it falls due, until the school edits it. */
const DEFAULTS: Record<FeeCode, { label: string; payableAtAcceptance: boolean }> = {
  registration: { label: "Application fee", payableAtAcceptance: true },
  admission: { label: "Admission fee", payableAtAcceptance: true },
  tuition_month: { label: "Tuition per month", payableAtAcceptance: false },
  tuition_term: { label: "Tuition per term", payableAtAcceptance: false },
  tuition_annual: { label: "Tuition for the year", payableAtAcceptance: false },
  stationery_annual: { label: "Annual stationery", payableAtAcceptance: false },
};

export const feeDefaults = (code: FeeCode) => DEFAULTS[code];

export function isFeeCode(value: unknown): value is FeeCode {
  return typeof value === "string" && (FEE_CODES as readonly string[]).includes(value);
}

/**
 * `fee_lines` is unique on (schedule_id, code), so a schedule holds at most
 * one of each kind. This is what is left to add.
 */
export function availableCodes(used: readonly string[]): FeeCode[] {
  return FEE_CODES.filter((c) => !used.includes(c));
}

/**
 * Where a line sorts, whenever it was added. Position comes from the
 * vocabulary rather than from the order someone happened to type things in,
 * so a fee added in March still reads above the tuition it precedes.
 */
export const canonicalPosition = (code: FeeCode) => FEE_CODES.indexOf(code) + 1;

export type SubmittedLine = {
  code: FeeCode;
  label: string;
  amount_minor: number;
  payable_at_acceptance: boolean;
  position: number;
};

export type ParsedLines = { keep: SubmittedLine[]; remove: FeeCode[] };

type FieldSource = { get(name: string): FormDataEntryValue | null };

/**
 * Reads back the lines a schedule card submitted.
 *
 * `codes` is what that card actually rendered, carried on the form itself.
 * Nothing outside it is touched: that is the whole fix for a save that used
 * to write the vocabulary instead of the schedule.
 */
export function parseSubmittedLines(form: FieldSource, codes: readonly string[]): ParsedLines {
  const keep: SubmittedLine[] = [];
  const remove: FeeCode[] = [];
  for (const code of codes) {
    if (!isFeeCode(code)) throw new Error(`"${code}" is not a fee we know about.`);
    if (form.get(`remove_${code}`) === "1") {
      remove.push(code);
      continue;
    }
    keep.push({ code, ...readLine(form, code, `amount_${code}`, `label_${code}`, `payable_${code}`) });
  }
  return { keep, remove };
}

/** The one new line a card may add per save, or null if none was chosen. */
export function parseNewLine(form: FieldSource, used: readonly string[]): SubmittedLine | null {
  const raw = form.get("newCode");
  if (typeof raw !== "string" || raw === "") return null;
  if (!isFeeCode(raw)) throw new Error(`"${raw}" is not a fee we know about.`);
  if (used.includes(raw)) throw new Error(`This schedule already has a ${DEFAULTS[raw].label.toLowerCase()}.`);
  return { code: raw, ...readLine(form, raw, "newAmount", "newLabel", "newPayable") };
}

function readLine(form: FieldSource, code: FeeCode, amountField: string, labelField: string, payableField: string) {
  const raw = String(form.get(amountField) ?? "").trim();
  const amount_minor = raw === "" ? 0 : parseMoneyToMinor(raw);
  if (amount_minor === null || amount_minor < 0) throw new Error(`"${raw}" is not an amount.`);
  const label = String(form.get(labelField) ?? "").trim();
  return {
    label: label || DEFAULTS[code].label,
    amount_minor,
    payable_at_acceptance: form.get(payableField) === "1",
    position: canonicalPosition(code),
  };
}

/** What a schedule costs, and what part of it is due to hold the place. */
export function scheduleTotals(lines: readonly { amount_minor: number | string; payable_at_acceptance: boolean }[]) {
  let total = 0;
  let atAcceptance = 0;
  for (const l of lines) {
    const amount = Number(l.amount_minor);
    total += amount;
    if (l.payable_at_acceptance) atAcceptance += amount;
  }
  return { total, atAcceptance };
}
