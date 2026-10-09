import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The applicant and referee cookies.
 *
 * A magic link is exchanged once for one of these: a short-lived, signed
 * value naming exactly one subject, with no personal data in it. There are
 * two, signed under different HMAC domains, so a bug in one decoder can never
 * turn an applicant's cookie into a referee's (and so let an applicant read
 * their own references), or the reverse:
 *
 *   hbs_hr_applicant  one application, path `/` (the form under /apply and
 *                     the upload routes under /api/apply both need it)
 *   hbs_hr_referee    one reference request, path `/reference`
 *
 * The signing helpers are the admissions ones (`web/lib/tokens/session.ts`),
 * keyed with the HR app's own secret and domain strings, so no admissions
 * cookie verifies here either.
 *
 * Pure, no Next imports, unit tested.
 */

export const APPLICANT_COOKIE = "hbs_hr_applicant";
export const REFEREE_COOKIE = "hbs_hr_referee";
export const PAYSLIP_COOKIE = "hbs_hr_payslip";

const APPLICANT_DOMAIN = "hr-applicant";
const REFEREE_DOMAIN = "hr-referee";
const PAYSLIP_DOMAIN = "hr-payslip";

export type ApplicantSession = { applicationId: string; issuedAt: number; expiresAt: number };
export type RefereeSession = { referenceRequestId: string; issuedAt: number; expiresAt: number };
export type PayslipSession = { payslipId: string; issuedAt: number; expiresAt: number };

export function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signPayload(payload: string, secret: string, domain: string): string {
  return createHmac("sha256", secret).update(`${domain}:${payload}`).digest("base64url");
}

export function verifyPayload(payload: string, signature: string, secret: string, domain: string): boolean {
  const expected = Buffer.from(signPayload(payload, secret, domain));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function splitSigned(value: string): { payload: string; signature: string } | null {
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  return { payload: value.slice(0, dot), signature: value.slice(dot + 1) };
}

function encode(subject: string, issuedAt: number, expiresAt: number, secret: string, domain: string): string {
  const payload = b64url(JSON.stringify({ s: subject, i: issuedAt, e: expiresAt }));
  return `${payload}.${signPayload(payload, secret, domain)}`;
}

function decode(
  value: string | undefined | null,
  secret: string,
  domain: string,
  now: number
): { subject: string; issuedAt: number; expiresAt: number } | null {
  if (!value) return null;
  const parts = splitSigned(value);
  if (!parts || !verifyPayload(parts.payload, parts.signature, secret, domain)) return null;
  let parsed: { s?: unknown; i?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(parts.payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.s !== "string" || typeof parsed.i !== "number" || typeof parsed.e !== "number") return null;
  if (parsed.e <= now) return null;
  return { subject: parsed.s, issuedAt: parsed.i, expiresAt: parsed.e };
}

export function encodeApplicantSession(s: ApplicantSession, secret: string): string {
  return encode(s.applicationId, s.issuedAt, s.expiresAt, secret, APPLICANT_DOMAIN);
}

export function decodeApplicantSession(value: string | undefined | null, secret: string, now = Date.now()): ApplicantSession | null {
  const d = decode(value, secret, APPLICANT_DOMAIN, now);
  return d ? { applicationId: d.subject, issuedAt: d.issuedAt, expiresAt: d.expiresAt } : null;
}

export function encodeRefereeSession(s: RefereeSession, secret: string): string {
  return encode(s.referenceRequestId, s.issuedAt, s.expiresAt, secret, REFEREE_DOMAIN);
}

export function decodeRefereeSession(value: string | undefined | null, secret: string, now = Date.now()): RefereeSession | null {
  const d = decode(value, secret, REFEREE_DOMAIN, now);
  return d ? { referenceRequestId: d.subject, issuedAt: d.issuedAt, expiresAt: d.expiresAt } : null;
}

export function encodePayslipSession(s: PayslipSession, secret: string): string {
  return encode(s.payslipId, s.issuedAt, s.expiresAt, secret, PAYSLIP_DOMAIN);
}

export function decodePayslipSession(value: string | undefined | null, secret: string, now = Date.now()): PayslipSession | null {
  const d = decode(value, secret, PAYSLIP_DOMAIN, now);
  return d ? { payslipId: d.subject, issuedAt: d.issuedAt, expiresAt: d.expiresAt } : null;
}
