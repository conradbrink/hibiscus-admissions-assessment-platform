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
 */

export const PARENT_COOKIE = "hbs_parent";

export type ParentSession = {
  applicationId: string;
  purpose: TokenPurpose;
  issuedAt: number;
  expiresAt: number;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeParentSession(session: ParentSession, secret: string): string {
  const payload = b64url(
    JSON.stringify({
      a: session.applicationId,
      p: session.purpose,
      i: session.issuedAt,
      e: session.expiresAt,
    })
  );
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Returns the session, or null for anything that is not a currently valid
 * signature: malformed, tampered, expired, or signed with a previous secret.
 * Constant-time on the signature comparison.
 */
export function decodeParentSession(
  value: string | undefined | null,
  secret: string,
  now: number = Date.now()
): ParentSession | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: { a?: unknown; p?: unknown; i?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
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
