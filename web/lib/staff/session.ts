import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, StaffProfileRow } from "@/lib/supabase/types";
import { can, toPermissionSet, type PermissionCode, type PermissionSet } from "@/lib/permissions";
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

/** For pages: redirects to login when signed out. */
export async function requireStaff(permission?: PermissionCode): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) redirect("/staff/login");
  if (permission && !can(ctx.permissions, permission)) redirect("/staff/no-access");
  return ctx;
}

/** For actions: throws, so the caller returns an error rather than redirecting a POST. */
export async function requireStaffAction(permission: PermissionCode): Promise<StaffContext> {
  const ctx = await getStaff();
  if (!ctx) throw new ForbiddenError(permission);
  if (!can(ctx.permissions, permission)) throw new ForbiddenError(permission);
  return ctx;
}
