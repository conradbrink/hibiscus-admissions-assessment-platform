import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, StaffProfileRow } from "@/lib/supabase/types";
import { can, isHrStaff, toPermissionSet, type PermissionCode, type PermissionSet } from "@/lib/permissions";
import { mfaOutcome, mfaRedirectPath, type AssuranceLevel } from "@/lib/staff/mfa";

/**
 * Who is asking, and what they may do, for HR staff pages and actions. The
 * same shape as the admissions console's `lib/staff/session.ts`, on the same
 * accounts: one login, two apps.
 *
 * The proxy has gated the page; this is the second line, for the action. A
 * server action is a POST endpoint and checks for itself.
 */
export type StaffContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  profile: StaffProfileRow;
  permissions: PermissionSet;
};

export class ForbiddenError extends Error {
  constructor(public readonly permission: PermissionCode | "any_hr") {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export class SecondFactorRequired extends Error {
  constructor(public readonly outcome: "verify" | "enrol") {
    super(outcome === "verify" ? "Enter the code from your authenticator app." : "Set up an authenticator app to continue.");
    this.name = "SecondFactorRequired";
  }
}

export class AuthCheckUnavailable extends Error {
  constructor() {
    super("Could not check your sign-in just now. Reload in a moment.");
    this.name = "AuthCheckUnavailable";
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

  return { supabase, userId: user.id, profile, permissions: toPermissionSet(granted) };
}

/**
 * Whether this session still owes a second factor. The school's switch is
 * the admissions `settings.staff_mfa_required`: one policy for one set of
 * accounts. A verdict that could not be reached refuses rather than waving
 * the person through.
 */
async function secondFactorOutstanding(ctx: StaffContext): Promise<"verify" | "enrol" | "unknown" | null> {
  const [{ data: setting, error: settingError }, { data: levels, error: levelError }] = await Promise.all([
    ctx.supabase.from("settings").select("value").eq("key", "staff_mfa_required").maybeSingle(),
    ctx.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (settingError || levelError) return "unknown";
  const outcome = mfaOutcome({
    hasVerifiedFactor: levels?.nextLevel === "aal2",
    currentLevel: (levels?.currentLevel ?? null) as AssuranceLevel | null,
    requiredBySchool: setting?.value === true,
  });
  return outcome === "ok" ? null : outcome;
}

/** For pages: redirects when signed out, half signed in, or not allowed. */
export async function requireStaff(permission?: PermissionCode): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) redirect("/staff/login");
  const owed = await secondFactorOutstanding(ctx);
  if (owed === "unknown") throw new AuthCheckUnavailable();
  if (owed) redirect(mfaRedirectPath(owed));
  if (!isHrStaff(ctx.permissions)) redirect("/staff/no-access");
  if (permission && !can(ctx.permissions, permission)) redirect("/staff/no-access");
  return ctx;
}

/** For actions: throws, so the caller returns an error rather than redirecting a POST. */
export async function requireStaffAction(permission: PermissionCode): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) throw new ForbiddenError(permission);
  const owed = await secondFactorOutstanding(ctx);
  if (owed === "unknown") throw new AuthCheckUnavailable();
  if (owed) throw new SecondFactorRequired(owed);
  if (!can(ctx.permissions, permission)) throw new ForbiddenError(permission);
  return ctx;
}

/** For the verify and security pages, which must open while a factor is owed. */
export async function requireSignedInStaff(): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) redirect("/staff/login");
  return ctx;
}
