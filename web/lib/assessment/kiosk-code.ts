import { createHash, randomInt } from "node:crypto";
import { b64url, signPayload, splitSigned, verifyPayload } from "@/lib/tokens/session";

/**
 * The code a lab computer types to open a child's assessment, and the
 * cookie it is exchanged for.
 *
 * Six characters from an alphabet without 0/O and 1/I, because it is read
 * off a screen and typed by a member of staff or an eight-year-old. About
 * a billion combinations; it is single use, expires in minutes, and its
 * entry is rate limited by IP, which is what makes six enough.
 *
 * Pure — no database, no Next — so the lifecycle is unit tested. The store
 * and the cookie plumbing are in ./kiosk-server.ts.
 */

export const KIOSK_COOKIE = "hbs_sit";
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

const DOMAIN = "kiosk";

export function generateKioskCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * Upper case, everything but letters and digits stripped, and the two
 * digits the alphabet omits mapped to the letters they are mistaken for: a
 * typed 0 means O and a typed 1 means I.
 */
export function normaliseKioskCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .slice(0, CODE_LENGTH);
}

export function isWellFormedKioskCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** Hash stored in kiosk_codes. Domain-prefixed so it is never a token hash. */
export function hashKioskCode(code: string): string {
  return createHash("sha256").update(`${DOMAIN}:${code}`).digest("base64url");
}

export type KioskSession = {
  attemptId: string;
  issuedAt: number;
  expiresAt: number;
};

export function encodeKioskSession(session: KioskSession, secret: string): string {
  const payload = b64url(JSON.stringify({ k: 1, a: session.attemptId, i: session.issuedAt, e: session.expiresAt }));
  return `${payload}.${signPayload(payload, secret, DOMAIN)}`;
}

export function decodeKioskSession(
  value: string | undefined | null,
  secret: string,
  now: number = Date.now()
): KioskSession | null {
  if (!value) return null;
  const parts = splitSigned(value);
  if (!parts) return null;
  if (!verifyPayload(parts.payload, parts.signature, secret, DOMAIN)) return null;
  let parsed: { k?: unknown; a?: unknown; i?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(parts.payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed.k !== 1 || typeof parsed.a !== "string" || typeof parsed.i !== "number" || typeof parsed.e !== "number") {
    return null;
  }
  if (parsed.e <= now) return null;
  return { attemptId: parsed.a, issuedAt: parsed.i, expiresAt: parsed.e };
}
