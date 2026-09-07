import { createHash } from "node:crypto";
import type { VerifyStatus } from "@/lib/payments/provider";

/**
 * PayGate PayWeb 3 on the wire: form-encoded fields in a fixed order, each
 * message sealed with an MD5 of the field values followed by the merchant's
 * encryption key. Pure functions, so the adapter is a thin fetch and the
 * arithmetic is tested without a gateway.
 *
 * Reference: PayGate "PayWeb 3" integration guide (initiate.trans,
 * process.trans, query.trans; the notify and return posts).
 */

export const PAYGATE_LIVE_API = "https://secure.paygate.co.za/payweb3/";

/** PayGate's own test merchant, for sandbox runs only. */
export const PAYGATE_TEST_ID = "10011072130";
export const PAYGATE_TEST_KEY = "secret";

export function md5Hex(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

/** MD5 of the values in order, then the key: how every PayWeb 3 message is sealed. */
export function checksumOf(values: ReadonlyArray<string>, key: string): string {
  return md5Hex(values.join("") + key);
}

export type InitiateInput = {
  paygateId: string;
  reference: string;
  amountMinor: number;
  currency: "BWP" | "ZAR";
  returnUrl: string;
  transactionDate: string;
  email: string;
  notifyUrl?: string | null;
};

/** ISO 3166-1 alpha-3, which is what PayGate wants in COUNTRY. */
export function countryFor(currency: "BWP" | "ZAR"): "BWA" | "ZAF" {
  return currency === "BWP" ? "BWA" : "ZAF";
}

/** "YYYY-MM-DD HH:MM:SS" in UTC, PayGate's TRANSACTION_DATE shape. */
export function paygateDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** The initiate.trans fields, in the order the checksum is computed over. */
export function buildInitiateFields(input: InitiateInput, key: string): Array<[string, string]> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("amountMinor must be a positive integer of cents");
  const fields: Array<[string, string]> = [
    ["PAYGATE_ID", input.paygateId],
    ["REFERENCE", input.reference],
    ["AMOUNT", String(input.amountMinor)],
    ["CURRENCY", input.currency],
    ["RETURN_URL", input.returnUrl],
    ["TRANSACTION_DATE", input.transactionDate],
    ["LOCALE", "en"],
    ["COUNTRY", countryFor(input.currency)],
    ["EMAIL", input.email],
  ];
  if (input.notifyUrl) fields.push(["NOTIFY_URL", input.notifyUrl]);
  fields.push(["CHECKSUM", checksumOf(fields.map(([, v]) => v), key)]);
  return fields;
}

/** The query.trans fields for one payment request. */
export function buildQueryFields(paygateId: string, payRequestId: string, reference: string, key: string): Array<[string, string]> {
  return [
    ["PAYGATE_ID", paygateId],
    ["PAY_REQUEST_ID", payRequestId],
    ["REFERENCE", reference],
    ["CHECKSUM", checksumOf([paygateId, payRequestId, reference], key)],
  ];
}

/** The checksum the browser must post to process.trans with the pay request id. */
export function processChecksum(paygateId: string, payRequestId: string, reference: string, key: string): string {
  return checksumOf([paygateId, payRequestId, reference], key);
}

export function encodeForm(fields: ReadonlyArray<[string, string]>): string {
  return fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

/** A PayGate response or post, in the order the fields arrived (the checksum depends on it). */
export function parseWire(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of new URLSearchParams(text)) out.push([k, v]);
  return out;
}

export function fieldMap(fields: ReadonlyArray<[string, string]>): Record<string, string> {
  return Object.fromEntries(fields);
}

/** True when the message's CHECKSUM matches MD5 of every other value, in order, plus the key. */
export function checksumValid(fields: ReadonlyArray<[string, string]>, key: string): boolean {
  const presented = fields.find(([k]) => k === "CHECKSUM")?.[1];
  if (!presented) return false;
  const expected = checksumOf(fields.filter(([k]) => k !== "CHECKSUM").map(([, v]) => v), key);
  return presented.toLowerCase() === expected;
}

/**
 * PayGate's TRANSACTION_STATUS: 0 not done, 1 approved, 2 declined,
 * 3 cancelled, 4 user cancelled, 5 received by PayGate, 7 settlement voided.
 */
export function mapTransactionStatus(status: string | undefined): VerifyStatus {
  switch (status) {
    case "1":
      return "paid";
    case "2":
    case "3":
    case "4":
    case "7":
      return "failed";
    default:
      return "pending";
  }
}

/** The fields worth keeping on the payment row. Never card data; PayGate never sends any. */
const KEEP = ["PAY_REQUEST_ID", "REFERENCE", "TRANSACTION_STATUS", "RESULT_CODE", "RESULT_DESC", "AUTH_CODE", "CURRENCY", "AMOUNT", "TRANSACTION_ID", "PAY_METHOD", "PAY_METHOD_DETAIL", "RISK_INDICATOR", "ERROR"] as const;

export function keepFields(fields: ReadonlyArray<[string, string]>): Record<string, string> {
  const m = fieldMap(fields);
  const out: Record<string, string> = {};
  for (const k of KEEP) if (m[k] !== undefined) out[k] = m[k];
  return out;
}
