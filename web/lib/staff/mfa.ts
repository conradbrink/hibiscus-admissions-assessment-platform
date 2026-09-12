/**
 * The second factor: who has to present one, and what they may reach until
 * they have.
 *
 * Everything the console protects rests on the person signing in being who
 * they say they are, and until now that rested on a password alone. A phished
 * password is the whole console: fourteen families' registrations, their
 * documents, the fee schedule, the offer letters.
 *
 * This module is the decision and nothing else — no Supabase, no cookies, no
 * redirects — because it is the part that must be right, and because the two
 * ways an authentication gate goes wrong are both expressible here:
 *
 *   letting somebody in who should have been asked, and
 *   locking somebody out with nowhere to go.
 *
 * The second is the likelier and the worse. A school of thirty staff cannot
 * ring anybody at seven in the morning, so every outcome below names a page
 * the person can actually reach, and the tests assert that.
 *
 * Pure. Unit tested.
 */

/** What Supabase calls the strength of the current session. */
export type AssuranceLevel = "aal1" | "aal2";

/**
 * A factor as Supabase reports it. `unverified` is a factor somebody started
 * enrolling and walked away from: it cannot be satisfied, because no
 * authenticator app ever received the secret.
 */
export type FactorStatus = "verified" | "unverified";

export type MfaState = {
  /**
   * Whether there is a factor that can actually be presented.
   *
   * A boolean rather than the factor list, because the two callers derive it
   * differently and both are right. On the server it is
   * `getAuthenticatorAssuranceLevel().nextLevel === "aal2"`, which Supabase
   * computes from the session's own verified factors and costs no round trip —
   * worth having, since this decision is made on every page load and every
   * action. In the browser, where the factor list is already to hand, it is
   * `hasUsableFactor(factors)`.
   *
   * Both filter to verified, which is the part that matters: see
   * `hasUsableFactor`.
   */
  hasVerifiedFactor: boolean;
  /** The level of the session as it stands. Null when there is no session. */
  currentLevel: AssuranceLevel | null;
  /** Whether the school requires a second factor of everybody. */
  requiredBySchool: boolean;
};

export type MfaOutcome =
  /** Nothing to do: either satisfied, or not asked of this person. */
  | "ok"
  /** They have a factor and have not used it yet on this session. */
  | "verify"
  /** The school requires one and they have not set one up. */
  | "enrol";

/**
 * A factor that can actually be presented. An unverified one cannot: it is an
 * enrolment somebody started and walked away from, so no authenticator app
 * ever received the secret and no code will ever match.
 *
 * Counting one as a reason to challenge is a locked door with no key, which is
 * why this filter exists rather than `factors.length > 0`.
 */
export function hasUsableFactor(factors: ReadonlyArray<{ status: FactorStatus }>): boolean {
  return factors.some((f) => f.status === "verified");
}

/**
 * What this person must do before the console opens.
 *
 * The order of these three is the whole design:
 *
 * 1. A session already at aal2 is done. Asking again would be a loop.
 *
 * 2. Somebody with a usable factor is challenged **whether or not the school
 *    requires it**. This looks like a detail and is not: if turning the
 *    setting off skipped their second factor, their password would silently
 *    become sufficient again, and they would have no way to know that the
 *    protection they set up had stopped applying. Opting in is the person's
 *    decision; opting out is not somebody else's.
 *
 * 3. Only then does the school's requirement apply, and only to somebody with
 *    nothing to present.
 *
 * A half-finished enrolment is not a reason to challenge, and both ways of
 * computing `hasVerifiedFactor` exclude one: otherwise the screen would demand
 * a code from an app that never received the secret, which is a locked door
 * with no key — the exact failure this module exists to avoid.
 */
export function mfaOutcome(state: MfaState): MfaOutcome {
  if (state.currentLevel === "aal2") return "ok";
  if (state.hasVerifiedFactor) return "verify";
  if (state.requiredBySchool) return "enrol";
  return "ok";
}

/** Where somebody signs in, or recovers a password. Never gated on a factor. */
export const MFA_EXEMPT_PREFIXES = ["/staff/login", "/staff/forgot-password", "/staff/reset-password"] as const;

/** The page that asks for the six digits. */
export const MFA_VERIFY_PATH = "/staff/verify";
/** The page that sets a factor up, and the only place one can be removed. */
export const MFA_SECURITY_PATH = "/staff/security";

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Whether a path may be opened while `outcome` is outstanding.
 *
 * The asymmetry between the two outcomes is the point, and it is a privilege
 * boundary rather than a nicety:
 *
 *   "enrol" lets the security page through, because otherwise there is no way
 *   to ever enrol and the requirement is a locked door.
 *
 *   "verify" does **not**. Somebody holding only a password must not reach the
 *   page where a factor can be removed — that page is how you turn a stolen
 *   password back into a full account. They have exactly one route, which is
 *   to present the code.
 *
 * Removing a factor is additionally gated on aal2 by the action itself; this
 * is the first of the two locks, not the only one.
 */
export function mfaPathAllowed(outcome: MfaOutcome, pathname: string): boolean {
  if (MFA_EXEMPT_PREFIXES.some((p) => matches(pathname, p))) return true;
  if (outcome === "ok") return true;
  if (outcome === "verify") return matches(pathname, MFA_VERIFY_PATH);
  return matches(pathname, MFA_SECURITY_PATH);
}

/** Where to send somebody who asked for a page they may not have yet. */
export function mfaRedirectPath(outcome: MfaOutcome): string {
  return outcome === "verify" ? MFA_VERIFY_PATH : MFA_SECURITY_PATH;
}
