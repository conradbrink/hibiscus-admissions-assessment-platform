import { createHmac, timingSafeEqual } from "node:crypto";
import type { TokenPurpose } from "@/lib/supabase/types";

/**
 * The parent session cookie.
 *
 * A magic link is exchanged for this: a short-lived, HMAC-signed value naming
 * exactly one application. Every parent page reads it and scopes every query
 * to that application id. It carries no personal data — an id, a purpose, two
 * timestamps.
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

export type ParentSession = {
  applicationId: string;
  purpose: TokenPurpose;
  issuedAt: number;
  expiresAt: number;
};

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

export function encodeParentSession(session: ParentSession, secret: string): string {
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
