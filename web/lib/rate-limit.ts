import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Server-side rate limiting for the public endpoints.
 *
 * Counting happens in Postgres (`consume_rate_limit`), not here: serverless
 * instances come and go and an in-memory tally resets on every cold start.
 *
 * The subject is a hashed IP or a normalised email, because the callers being
 * protected are anonymous parents. Ported from the merchandising app, where
 * the subject came from the session.
 */

export type Limit = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export const LIMITS = {
  /** Creating an application. Ten per hour per address is generous for a family and hostile to a script. */
  enquiry: { bucket: "enquiry", limit: 10, windowSeconds: 3600 },
  /** Resolving a magic link. Tokens are 256-bit; this is about noise, not guessing. */
  tokenResolve: { bucket: "token_resolve", limit: 30, windowSeconds: 600 },
  /** Asking for a fresh link, per address. */
  freshLinkByIp: { bucket: "fresh_link_ip", limit: 10, windowSeconds: 3600 },
  /** Asking for a fresh link, per email — stops one address being used to spam a parent. */
  freshLinkByEmail: { bucket: "fresh_link_email", limit: 3, windowSeconds: 3600 },
  /** Funnel instrumentation writes. */
  funnelEvent: { bucket: "funnel_event", limit: 300, windowSeconds: 3600 },
  /** Booking or changing a slot from a parent session. */
  parentBooking: { bucket: "parent_booking", limit: 20, windowSeconds: 3600 },
  /** Typing a launch code on a lab computer, per address. Codes are single use; this stops guessing. */
  kioskCode: { bucket: "kiosk_code", limit: 20, windowSeconds: 600 },
  /** Autosaving answers, per attempt. Generous: a quick child answers a question every few seconds. */
  kioskResponse: { bucket: "kiosk_response", limit: 900, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Consumes quota. Fails **open** on a counting error: losing the ability to
 * count is a worse reason to stop parents enquiring than letting a handful
 * through un-counted. The failure is logged.
 */
export async function enforceRateLimit(
  admin: AdminClient,
  limit: Limit,
  subject: string,
  cost = 1
): Promise<Verdict> {
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_bucket: limit.bucket,
    p_subject: subject,
    p_limit: limit.limit,
    p_window_seconds: limit.windowSeconds,
    p_cost: cost,
  });
  if (error) {
    console.error(`[rate-limit] ${limit.bucket} could not be counted: ${error.message}`);
    return { ok: true };
  }
  const v = data as { allowed: boolean; remaining: number; retry_after_seconds: number };
  if (v.allowed) return { ok: true };
  console.warn(`[rate-limit] ${limit.bucket} exhausted for a subject`);
  return { ok: false, retryAfterSeconds: Math.max(v.retry_after_seconds, 1) };
}
