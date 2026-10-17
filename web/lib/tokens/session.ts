import { createHmac, timingSafeEqual } from "node:crypto";
import type { TokenPurpose } from "@/lib/supabase/types";

/**
 * The parent session cookies.
 *
 * A magic link is exchanged for one of these: a short-lived, HMAC-signed
 * value naming exactly one subject. It carries no personal data — an id, a
 * purpose, two timestamps.
 *
 * There are two, and they are deliberately separate:
 *
 *   hbs_parent  one application, path `/`. The funnel: booking, results, the
 *               offer, payment, registration.
 *   hbs_family  one family, path `/family`. The CRM: every child at once, for
 *               as long as the family is with the school.
 *   hbs_transport  one school transport booking, path `/transport`. Minted
 *               when a stranger submits the public booking form, not from a
 *               magic link, so it carries no token purpose.
 *
 * A family cookie is strictly more powerful than an application cookie — it
 * reaches every child — so it is signed under its own HMAC domain. A bug in
 * one decoder therefore cannot promote a funnel cookie into a family one, or
 * the reverse. Two cookies also let a parent hold a funnel session for a new
 * child and a family session for the enrolled ones at the same time, which
 * will be the ordinary case once siblings exist.
 *
 * Pure functions, no Next imports, so the signing and verification are unit
 * tested in isolation. The cookie plumbing is in ./server.ts.
 *
 * The signing helpers are exported for the kiosk session (lib/assessment/
 * kiosk-code.ts), which signs with the same secret under a different domain
 * string, so a parent cookie can never be presented as a kiosk cookie or the
 * reverse even though both are HMACs of a JSON payload.
 */

export const PARENT_COOKIE = "hbs_parent";
export const FAMILY_COOKIE = "hbs_family";
export const TRANSPORT_COOKIE = "hbs_transport";

export type ApplicationSession = {
  applicationId: string;
  purpose: TokenPurpose;
  issuedAt: number;
  expiresAt: number;
};

export type FamilySession = {
  familyId: string;
  purpose: TokenPurpose;
  issuedAt: number;
  expiresAt: number;
};

/**
 * One transport booking, for the person who just typed it in. It names a
 * booking and nothing else: no family, no application, no child.
 */
export type TransportSession = {
  bookingId: string;
  issuedAt: number;
  expiresAt: number;
};

/**
 * Kept as the name of the application session so every existing caller reads
 * the same. The family session is its own type rather than a member of a
 * union with it: nothing that scopes by application should ever compile
 * against a value that might not have one, and `"familyId" in session`
 * separates them where anything genuinely handles both.
 */
export type ParentSession = ApplicationSession;

export function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** HMAC over `domain:payload`, so signatures from different domains never verify. */
export function signPayload(payload: string, secret: string, domain: string): string {
  return createHmac("sha256", secret).update(`${domain}:${payload}`).digest("base64url");
}

/** Constant-time on the signature comparison. */
export function verifyPayload(payload: string, signature: string, secret: string, domain: string): boolean {
  const expected = signPayload(payload, secret, domain);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Splits `payload.signature`; null when the shape is wrong. */
export function splitSigned(value: string): { payload: string; signature: string } | null {
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  return { payload: value.slice(0, dot), signature: value.slice(dot + 1) };
}

const PARENT_DOMAIN = "parent";
const FAMILY_DOMAIN = "family";
const TRANSPORT_DOMAIN = "transport";

export function encodeParentSession(session: ParentSession, secret: string): string {
  // The keys stay exactly as they were, so every cookie already in a parent's
  // browser still decodes after this deploy.
  const payload = b64url(
    JSON.stringify({
      a: session.applicationId,
      p: session.purpose,
      i: session.issuedAt,
      e: session.expiresAt,
    })
  );
  return `${payload}.${signPayload(payload, secret, PARENT_DOMAIN)}`;
}

export function encodeFamilySession(session: FamilySession, secret: string): string {
  const payload = b64url(
    JSON.stringify({
      f: session.familyId,
      p: session.purpose,
      i: session.issuedAt,
      e: session.expiresAt,
    })
  );
  return `${payload}.${signPayload(payload, secret, FAMILY_DOMAIN)}`;
}

/**
 * Returns the session, or null for anything that is not a currently valid
 * signature: malformed, tampered, expired, or signed with a previous secret.
 */
export function decodeParentSession(
  value: string | undefined | null,
  secret: string,
  now: number = Date.now()
): ParentSession | null {
  if (!value) return null;
  const parts = splitSigned(value);
  if (!parts) return null;
  if (!verifyPayload(parts.payload, parts.signature, secret, PARENT_DOMAIN)) return null;

  let parsed: { a?: unknown; p?: unknown; i?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(parts.payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed.a !== "string" ||
    typeof parsed.p !== "string" ||
    typeof parsed.i !== "number" ||
    typeof parsed.e !== "number"
  ) {
    return null;
  }
  if (parsed.e <= now) return null;
  return {
    applicationId: parsed.a,
    purpose: parsed.p as TokenPurpose,
    issuedAt: parsed.i,
    expiresAt: parsed.e,
  };
}

/**
 * The family twin. Same shape of checks, different domain and different key,
 * so neither cookie can be read as the other however it was obtained.
 */
export function decodeFamilySession(
  value: string | undefined | null,
  secret: string,
  now: number = Date.now()
): FamilySession | null {
  if (!value) return null;
  const parts = splitSigned(value);
  if (!parts) return null;
  if (!verifyPayload(parts.payload, parts.signature, secret, FAMILY_DOMAIN)) return null;

  let parsed: { f?: unknown; p?: unknown; i?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(parts.payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed.f !== "string" ||
    typeof parsed.p !== "string" ||
    typeof parsed.i !== "number" ||
    typeof parsed.e !== "number"
  ) {
    return null;
  }
  if (parsed.e <= now) return null;
  return {
    familyId: parsed.f,
    purpose: parsed.p as TokenPurpose,
    issuedAt: parsed.i,
    expiresAt: parsed.e,
  };
}

/**
 * The transport booking cookie. Its own domain, like the family one: the
 * booking form is anonymous, so this cookie is the easiest of the three to
 * come by, and it must never be readable as either of the others.
 */
export function encodeTransportSession(session: TransportSession, secret: string): string {
  const payload = b64url(JSON.stringify({ b: session.bookingId, i: session.issuedAt, e: session.expiresAt }));
  return `${payload}.${signPayload(payload, secret, TRANSPORT_DOMAIN)}`;
}

export function decodeTransportSession(
  value: string | undefined | null,
  secret: string,
  now: number = Date.now()
): TransportSession | null {
  if (!value) return null;
  const parts = splitSigned(value);
  if (!parts) return null;
  if (!verifyPayload(parts.payload, parts.signature, secret, TRANSPORT_DOMAIN)) return null;

  let parsed: { b?: unknown; i?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(parts.payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.b !== "string" || typeof parsed.i !== "number" || typeof parsed.e !== "number") return null;
  if (parsed.e <= now) return null;
  return { bookingId: parsed.b, issuedAt: parsed.i, expiresAt: parsed.e };
}
