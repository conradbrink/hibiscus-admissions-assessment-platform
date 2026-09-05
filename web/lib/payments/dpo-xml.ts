import { decimalToMinor, minorToDecimal } from "@/lib/payments/amounts";
import type { VerifyStatus } from "@/lib/payments/provider";

/**
 * DPO Pay's API v6 speaks XML over HTTPS. This is the pure half: building
 * the two requests we send and reading the responses we get back. No
 * network, no secrets beyond the token passed in, so vitest covers it and
 * the wire format is pinned by fixtures rather than remembered.
 *
 * Result codes (verifyToken): 000 paid; 900 not paid yet; 901 declined;
 * 903 expired; 904 cancelled. Anything else is treated as not paid.
 */

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export type CreateTokenInput = {
  companyToken: string;
  serviceType: string;
  amountMinor: number;
  currency: string;
  companyRef: string;
  description: string;
  redirectUrl: string;
  backUrl: string;
  ptlHours: number;
  customer: { email: string; firstName: string; lastName: string };
  /** ISO date for ServiceDate (YYYY/MM/DD HH:mm). Injected so tests are stable. */
  serviceDate: string;
};

export function buildCreateTokenXml(input: CreateTokenInput): string {
  const e = xmlEscape;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<API3G>",
    `<CompanyToken>${e(input.companyToken)}</CompanyToken>`,
    "<Request>createToken</Request>",
    "<Transaction>",
    `<PaymentAmount>${minorToDecimal(input.amountMinor)}</PaymentAmount>`,
    `<PaymentCurrency>${e(input.currency)}</PaymentCurrency>`,
    `<CompanyRef>${e(input.companyRef)}</CompanyRef>`,
    `<RedirectURL>${e(input.redirectUrl)}</RedirectURL>`,
    `<BackURL>${e(input.backUrl)}</BackURL>`,
    "<CompanyRefUnique>1</CompanyRefUnique>",
    `<PTL>${Math.max(1, Math.round(input.ptlHours))}</PTL>`,
    `<customerEmail>${e(input.customer.email)}</customerEmail>`,
    `<customerFirstName>${e(input.customer.firstName)}</customerFirstName>`,
    `<customerLastName>${e(input.customer.lastName)}</customerLastName>`,
    "</Transaction>",
    "<Services>",
    "<Service>",
    `<ServiceType>${e(input.serviceType)}</ServiceType>`,
    `<ServiceDescription>${e(input.description)}</ServiceDescription>`,
    `<ServiceDate>${e(input.serviceDate)}</ServiceDate>`,
    "</Service>",
    "</Services>",
    "</API3G>",
  ].join("");
}

export function buildVerifyTokenXml(companyToken: string, transToken: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<API3G>",
    `<CompanyToken>${xmlEscape(companyToken)}</CompanyToken>`,
    "<Request>verifyToken</Request>",
    `<TransactionToken>${xmlEscape(transToken)}</TransactionToken>`,
    "</API3G>",
  ].join("");
}

/** The tags we read. Anything else in the body is ignored, never stored. */
export const DPO_RESPONSE_TAGS = [
  "Result",
  "ResultExplanation",
  "TransToken",
  "TransRef",
  "CustomerName",
  "TransactionApproval",
  "TransactionCurrency",
  "TransactionAmount",
  "TransactionNetAmount",
  "TransactionFinalAmount",
  "TransactionFinalCurrency",
  "TransactionSettlementDate",
] as const;

export type DpoResponse = Partial<Record<(typeof DPO_RESPONSE_TAGS)[number], string>>;

export function parseDpoResponse(xml: string): DpoResponse {
  const out: DpoResponse = {};
  for (const tag of DPO_RESPONSE_TAGS) {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
    if (m) out[tag] = xmlUnescape(m[1].trim());
  }
  return out;
}

export function mapVerifyResult(code: string | undefined): VerifyStatus {
  switch (code) {
    case "000":
      return "paid";
    case "900":
      return "pending";
    case "903":
      return "expired";
    case "901":
    case "904":
      return "failed";
    default:
      return "failed";
  }
}

export function dpoAmountToMinor(value: string | undefined): number | null {
  return decimalToMinor(value);
}

/** "2026/09/05 14:03" in the school's day, the format DPO documents. */
export function dpoServiceDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
