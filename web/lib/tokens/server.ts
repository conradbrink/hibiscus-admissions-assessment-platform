import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { TokenPurpose } from "@/lib/supabase/types";
import {
  decodeFamilySession,
  decodeParentSession,
  encodeFamilySession,
  encodeParentSession,
  FAMILY_COOKIE,
  PARENT_COOKIE,
  type FamilySession,
  type ParentSession,
} from "@/lib/tokens/session";

function secret(): string {
  const s = process.env.PARENT_SESSION_SECRET;
  if (!s) throw new Error("PARENT_SESSION_SECRET is not set.");
  return s;
}

/** Sets the cookie after a token has been verified. */
export async function startParentSession(
  applicationId: string,
  purpose: TokenPurpose,
  ttlMinutes: number
): Promise<void> {
  const now = Date.now();
  const session: ParentSession = {
    applicationId,
    purpose,
    issuedAt: now,
    expiresAt: now + ttlMinutes * 60_000,
  };
  const store = await cookies();
  store.set(PARENT_COOKIE, encodeParentSession(session, secret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttlMinutes * 60,
  });
}

export async function endParentSession(): Promise<void> {
  const store = await cookies();
  store.delete(PARENT_COOKIE);
}

/** The current parent session, or null. Never throws. */
export async function readParentSession(): Promise<ParentSession | null> {
  const store = await cookies();
  return decodeParentSession(store.get(PARENT_COOKIE)?.value, secret());
}

/**
 * For parent pages. A missing or expired session redirects to the page that
 * explains how to get a fresh link — a parent who opens a bookmark a week
 * later must never see a blank error.
 */
export async function requireParentSession(): Promise<ParentSession> {
  const session = await readParentSession();
  if (!session) redirect("/link?expired=1");
  return session;
}

// ---------------------------------------------------------------------------
// The family session: same mechanics, its own cookie, its own scope
// ---------------------------------------------------------------------------

/**
 * Scoped to `/family` rather than `/`, so it is never sent to a funnel page
 * that has no business with it, and signed under its own HMAC domain — see
 * the note in ./session.ts on why the two are kept apart.
 */
export async function startFamilySession(
  familyId: string,
  purpose: TokenPurpose,
  ttlMinutes: number
): Promise<void> {
  const now = Date.now();
  const session: FamilySession = {
    familyId,
    purpose,
    issuedAt: now,
    expiresAt: now + ttlMinutes * 60_000,
  };
  const store = await cookies();
  store.set(FAMILY_COOKIE, encodeFamilySession(session, secret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/family",
    maxAge: ttlMinutes * 60,
  });
}

export async function endFamilySession(): Promise<void> {
  const store = await cookies();
  store.delete({ name: FAMILY_COOKIE, path: "/family" });
}

/** The current family session, or null. Never throws. */
export async function readFamilySession(): Promise<FamilySession | null> {
  const store = await cookies();
  return decodeFamilySession(store.get(FAMILY_COOKIE)?.value, secret());
}

export async function requireFamilySession(): Promise<FamilySession> {
  const session = await readFamilySession();
  if (!session) redirect("/link?expired=1");
  return session;
}
