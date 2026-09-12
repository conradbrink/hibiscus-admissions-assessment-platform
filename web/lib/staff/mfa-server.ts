import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "@/lib/settings";
import { mfaOutcome, type AssuranceLevel, type MfaOutcome } from "@/lib/staff/mfa";
import type { Database } from "@/lib/supabase/types";

/**
 * Asking Supabase what it knows about this person's second factor, so
 * `mfaOutcome` can decide. The decision itself is pure and lives next door in
 * mfa.ts; this is only the reading of it.
 *
 * Two failures are possible and they are not the same fact, which is the
 * distinction the proxy already makes for permissions: "this person has no
 * factor" and "we could not find out" must not produce the same answer. The
 * first is an answer. The second is a broken call, and answering it with
 * either "let them in" or "lock them out" is wrong — one is a hole, the other
 * strands the whole school on a page they cannot leave. So it is its own
 * result, and the caller decides (the proxy returns 503, as it does for a
 * failed permission read).
 */
export type MfaVerdict = { ok: true; outcome: MfaOutcome } | { ok: false; reason: string };

/**
 * One call, and no round trip to the auth server.
 *
 * `getAuthenticatorAssuranceLevel` reads the session that `getUser` already
 * validated: `currentLevel` comes from the JWT's `aal` claim, and `nextLevel`
 * is `aal2` exactly when the session carries a **verified** factor. So it
 * answers both halves of the question at once — "has one" and "has used it" —
 * which matters, because this runs on every page load and every action and
 * `listFactors` would put a network call on each of them.
 *
 * The trade is that a factor an administrator cleared a minute ago can still
 * be named by a session opened before that. The person that affects is the one
 * whose device is gone, and their way out is to sign in again, which the verify
 * screen offers.
 */
export async function mfaVerdict(supabase: SupabaseClient<Database>): Promise<MfaVerdict> {
  const settings = await getSettings(supabase).catch(() => null);
  if (!settings) return { ok: false, reason: "settings unavailable" };

  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    outcome: mfaOutcome({
      hasVerifiedFactor: data?.nextLevel === "aal2",
      currentLevel: (data?.currentLevel ?? null) as AssuranceLevel | null,
      requiredBySchool: settings.staffMfaRequired,
    }),
  };
}
