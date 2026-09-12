import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, StaffProfileRow } from "@/lib/supabase/types";
import { can, toPermissionSet, type PermissionCode, type PermissionSet } from "@/lib/permissions";
import { MFA_SECURITY_PATH, MFA_VERIFY_PATH, mfaRedirectPath } from "@/lib/staff/mfa";
import { mfaVerdict } from "@/lib/staff/mfa-server";
import type { Actor } from "@/lib/workflow/engine";

/**
 * Who is asking, and what they may do — for staff pages and server actions.
 *
 * The proxy has already gated the *page*. This is the second line, for the
 * *action*: a server action is a POST endpoint and must check for itself.
 * It returns the RLS-bound client for reads and writes that RLS governs,
 * and the actor to stamp on anything that goes through the engine.
 */
export type StaffContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  profile: StaffProfileRow;
  permissions: PermissionSet;
  actor: Actor;
};

export class ForbiddenError extends Error {
  constructor(public readonly permission: PermissionCode) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/**
 * A session that has a password behind it but not the second factor it owes.
 *
 * Its own class because the answer is different from a missing permission: the
 * person is not forbidden, they are half signed in, and the fix is a code
 * rather than an administrator.
 */
export class SecondFactorRequired extends Error {
  constructor(public readonly outcome: "verify" | "enrol") {
    super(outcome === "verify" ? "Enter the code from your authenticator app." : "Set up an authenticator app to continue.");
    this.name = "SecondFactorRequired";
  }
}

export async function getStaff(): Promise<StaffContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: granted }] = await Promise.all([
    supabase.from("staff_profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.rpc("my_permissions"),
  ]);
  if (!profile || !profile.is_active) return null;

  return {
    supabase,
    userId: user.id,
    profile,
    permissions: toPermissionSet(granted),
    actor: { type: "staff", id: user.id, label: profile.email },
  };
}

/**
 * Whether this session still owes a second factor.
 *
 * The proxy gates pages on the same question, and this is here because a
 * server action is a POST endpoint the proxy's redirect never sees: without
 * it, a session stopped at the verify screen could still drive every action
 * in the console by name. The proxy decides what renders; this decides what
 * happens.
 *
 * A verdict that could not be reached is not "nothing owed". It refuses,
 * because the alternative is that an auth server having a bad minute silently
 * turns the second factor off for everybody.
 */
async function secondFactorOutstanding(ctx: StaffContext): Promise<"verify" | "enrol" | "unknown" | null> {
  const verdict = await mfaVerdict(ctx.supabase);
  if (!verdict.ok) {
    console.warn("[staff] could not establish the second factor:", verdict.reason);
    return "unknown";
  }
  return verdict.outcome === "ok" ? null : verdict.outcome;
}

/**
 * What to do when the verdict could not be reached at all.
 *
 * Not a redirect, and this is the trap worth naming: sending an unknown
 * verdict to the verify screen would strand anybody who has no factor on a
 * page asking for a code they cannot produce, with no way onward — an auth
 * server having a bad minute would lock the whole school out of admissions.
 * Nor may it fall through as "nothing owed", which would turn the same bad
 * minute into the second factor being off for everybody.
 *
 * So it is neither: it is an error the person can act on by reloading, which
 * is the same answer the proxy gives when a permission read fails.
 */
export class AuthCheckUnavailable extends Error {
  constructor() {
    super("Could not check your sign-in just now. Reload in a moment.");
    this.name = "AuthCheckUnavailable";
  }
}

/** For pages: redirects to login when signed out. */
export async function requireStaff(permission?: PermissionCode): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) redirect("/staff/login");
  const owed = await secondFactorOutstanding(ctx);
  if (owed === "unknown") throw new AuthCheckUnavailable();
  if (owed) redirect(mfaRedirectPath(owed));
  if (permission && !can(ctx.permissions, permission)) redirect("/staff/no-access");
  return ctx;
}

/**
 * For actions: throws, so the caller returns an error rather than redirecting
 * a POST.
 *
 * The second factor is checked before the permission, and deliberately: a
 * half-signed-in session should be told to finish signing in, not told it
 * lacks a permission it may well hold.
 */
export async function requireStaffAction(permission: PermissionCode): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) throw new ForbiddenError(permission);
  const owed = await secondFactorOutstanding(ctx);
  if (owed === "unknown") throw new AuthCheckUnavailable();
  if (owed) throw new SecondFactorRequired(owed);
  if (!can(ctx.permissions, permission)) throw new ForbiddenError(permission);
  return ctx;
}

/**
 * The pages that must work while a second factor is outstanding, and so cannot
 * use `requireStaff`: the screen that asks for the code, and the one that sets
 * an authenticator up. Signed in is all they require.
 *
 * `MFA_SECURITY_PATH` is additionally where a factor comes *off*, and that is
 * gated separately on the session being at aal2 — a password alone must not be
 * able to undo the protection. See the action on that page.
 */
export async function requireSignedInStaff(): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) redirect("/staff/login");
  return ctx;
}

export { MFA_SECURITY_PATH, MFA_VERIFY_PATH };
