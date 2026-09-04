import "server-only";
import { cookies } from "next/headers";
import type { AdminClient } from "@/lib/supabase/admin";
import {
  KIOSK_COOKIE,
  decodeKioskSession,
  encodeKioskSession,
  generateKioskCode,
  hashKioskCode,
  isWellFormedKioskCode,
  normaliseKioskCode,
  type KioskSession,
} from "@/lib/assessment/kiosk-code";

/**
 * The kiosk code store and the kiosk cookie. The pure parts are in
 * ./kiosk-code.ts; this file is what touches the database and the request.
 */

function secret(): string {
  const s = process.env.PARENT_SESSION_SECRET;
  if (!s) throw new Error("PARENT_SESSION_SECRET is not set.");
  return s;
}

/** Creates a code for an attempt. The raw code is returned once, for the launch dialog. */
export async function mintKioskCode(
  admin: AdminClient,
  attemptId: string,
  ttlMinutes: number
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateKioskCode();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
  const { error } = await admin.from("kiosk_codes").insert({
    attempt_id: attemptId,
    code_hash: hashKioskCode(code),
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(error.message);
  return { code, expiresAt };
}

/**
 * Single use, atomically: the update that stamps `used_at` is the check. A
 * second machine typing the same code finds nothing to update.
 */
export async function consumeKioskCode(
  admin: AdminClient,
  rawCode: string
): Promise<{ ok: true; attemptId: string } | { ok: false }> {
  const code = normaliseKioskCode(rawCode);
  if (!isWellFormedKioskCode(code)) return { ok: false };
  const { data, error } = await admin
    .from("kiosk_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", hashKioskCode(code))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("attempt_id");
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return row ? { ok: true, attemptId: row.attempt_id } : { ok: false };
}

/** Sets the attempt-scoped cookie. Lives until the attempt's clock plus grace. */
export async function startKioskSession(attemptId: string, expiresAt: Date): Promise<void> {
  const now = Date.now();
  const session: KioskSession = { attemptId, issuedAt: now, expiresAt: expiresAt.getTime() };
  const store = await cookies();
  store.set(KIOSK_COOKIE, encodeKioskSession(session, secret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Strict: nothing on another site can carry this cookie into a request.
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(60, Math.ceil((expiresAt.getTime() - now) / 1000)),
  });
}

/**
 * After a code is accepted: start the clock (idempotent if already started)
 * and set the cookie to outlive it by the grace period.
 */
export async function openAttemptSession(
  admin: AdminClient,
  attemptId: string,
  userAgent: string | null,
  graceSeconds: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: attempt, error } = await admin.rpc("start_attempt", { p_attempt_id: attemptId, p_user_agent: userAgent });
  if (error) return { ok: false, reason: error.message };
  if (!attempt?.expires_at) return { ok: false, reason: "attempt has no clock" };
  await startKioskSession(attemptId, new Date(new Date(attempt.expires_at).getTime() + graceSeconds * 1000));
  return { ok: true };
}

export async function endKioskSession(): Promise<void> {
  const store = await cookies();
  store.delete(KIOSK_COOKIE);
}

export async function readKioskSession(): Promise<KioskSession | null> {
  const store = await cookies();
  return decodeKioskSession(store.get(KIOSK_COOKIE)?.value, secret());
}
