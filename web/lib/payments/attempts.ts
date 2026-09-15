import type { PaymentRow } from "@/lib/supabase/types";

/**
 * How long a hosted checkout stays open at the gateway. Pure, and defined
 * here rather than beside the providers, so the helpers below — and their
 * tests — need nothing that only runs on the server.
 */
export const CHECKOUT_TTL_HOURS = 24;

/**
 * Which online attempts a parent-facing check asks the gateway about.
 *
 * Not only the ones still `processing`. We give up on a checkout after a few
 * minutes (`payment_attempt_minutes`) and mark it expired, and a parent can
 * still be on their bank's one-time-password screen when that happens. They
 * finish, the gateway takes the money, and it sends them back to us — to a
 * return route that, until this, only looked at processing rows and so found
 * nothing. The page then said "not completed, nothing has been charged", and
 * a parent who believed it paid twice.
 *
 * So the return, the parent's "check again" and the family's equivalents look
 * at every recent online attempt with a reference at the gateway and ask
 * about each with `revive`: an expired or failed row that the gateway now
 * says was paid settles; one it still says was not stays as it is. "Recent"
 * is the gateway's own checkout window — after that the hosted page has gone
 * and there is nothing a late answer could be about.
 */
export const ATTEMPT_STATUSES: ReadonlyArray<PaymentRow["status"]> = ["processing", "expired", "failed"];

/** Attempts newer than this can still have an answer at the gateway. */
export function recentAttemptsSince(now: number = Date.now()): string {
  return new Date(now - CHECKOUT_TTL_HOURS * 3_600_000).toISOString();
}

/** Only an online attempt the gateway knows by reference can be asked about. */
export function askable(payment: Pick<PaymentRow, "status" | "method" | "provider_ref">): boolean {
  return payment.method === "online" && payment.provider_ref !== null && ATTEMPT_STATUSES.includes(payment.status);
}

/**
 * The attempt a parent can still usefully ask about: the newest one we gave
 * up on that the gateway knows by reference, within its checkout window.
 * Chosen over the newest failure of any kind, because a checkout the gateway
 * refused to open (no reference, nothing to ask about) can come after it and
 * must not hide the one that may have been paid.
 */
export function lateAttemptOf<T extends Pick<PaymentRow, "status" | "method" | "provider_ref" | "created_at">>(
  payments: T[],
  now: number = Date.now()
): T | null {
  const since = recentAttemptsSince(now);
  return payments.find((p) => p.status === "expired" && p.method === "online" && p.provider_ref !== null && p.created_at >= since) ?? null;
}

/**
 * The attempt the gateway named first, the rest after it. The gateway's own
 * token is never trusted for the verdict — only for which row to ask about
 * first, so the parent's answer is one round trip away.
 */
export function hintFirst<T extends Pick<PaymentRow, "provider_ref">>(payments: T[], hint: string | null): T[] {
  if (!hint) return [...payments];
  return [...payments].sort((a, b) => (a.provider_ref === hint ? -1 : b.provider_ref === hint ? 1 : 0));
}
