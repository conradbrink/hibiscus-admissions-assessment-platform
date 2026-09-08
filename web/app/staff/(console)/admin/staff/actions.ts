"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { PERMISSION_CODES } from "@/lib/permissions";

function ids(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * A campus-scoped role (a campus administrator) with no campus sees
 * nothing, by design; saving that combination is a mistake, so refuse it
 * here where the person can fix it rather than at their first sign-in.
 */
async function assertCampusScopedRolesHaveCampuses(
  client: SupabaseClient<Database>,
  roleIds: string[],
  campusIds: string[]
): Promise<void> {
  if (!roleIds.length || campusIds.length) return;
  const { data } = await client.from("roles").select("name, campus_scoped").in("id", roleIds);
  const scoped = (data ?? []).filter((r) => r.campus_scoped).map((r) => r.name);
  if (scoped.length) throw new Error(`${scoped.join(", ")} is limited to campuses; choose at least one campus.`);
}

/**
 * Invites a member of staff. Creates the auth user (Supabase emails them a
 * link to set a password), the profile, and the roles — the auth part needs
 * the service role, which is why this is the one staff action that uses it.
 */
export async function inviteStaff(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const p = z
      .object({ email: z.email(), fullName: z.string().trim().min(1).max(120) })
      .parse({ email: formData.get("email"), fullName: formData.get("fullName") });
    const roleIds = ids(formData, "roleIds");
    const campusIds = ids(formData, "campusIds");

    const admin = createAdminClient();
    await assertCampusScopedRolesHaveCampuses(admin, roleIds, campusIds);
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/staff/reset-password`;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(p.email, { redirectTo });
    if (error) throw new Error(error.message);
    const userId = data.user.id;

    const { error: pErr } = await admin
      .from("staff_profiles")
      .upsert({ id: userId, full_name: p.fullName, email: p.email, is_active: true });
    if (pErr) throw new Error(pErr.message);
    if (roleIds.length) {
      const { error: rErr } = await admin.from("staff_roles").insert(roleIds.map((role_id) => ({ staff_id: userId, role_id })));
      if (rErr) throw new Error(rErr.message);
    }
    if (campusIds.length) {
      await admin.from("staff_campuses").insert(campusIds.map((campus_id) => ({ staff_id: userId, campus_id })));
    }
    await admin.from("audit_log").insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: "staff.invited",
      entity_type: "staff_profile",
      entity_id: userId,
      after: { email: p.email, roles: roleIds, campuses: campusIds },
    });
    revalidatePath("/staff/admin/staff");
  });
}

/**
 * Sends the invitation again to someone who has not yet accepted the first
 * one. Supabase refuses to re-invite a confirmed user, so the button only
 * shows for people who have never signed in; the guard here repeats that
 * check server-side. Supabase also rate-limits auth emails per address
 * (one a minute), and that error is passed through as it is.
 */
export async function resendInvite(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const { staffId } = z.object({ staffId: z.uuid() }).parse({ staffId: formData.get("staffId") });

    const admin = createAdminClient();
    const { data: profile } = await admin.from("staff_profiles").select("id, email, is_active").eq("id", staffId).single();
    if (!profile) throw new Error("That member of staff no longer exists.");
    if (!profile.is_active) throw new Error("This person is deactivated. Tick \"Can sign in\" and save first.");
    const { data: user } = await admin.auth.admin.getUserById(staffId);
    if (user.user?.email_confirmed_at) throw new Error("This person has already accepted their invitation. They can reset their password from the sign-in page.");

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/staff/reset-password`;
    const { error } = await admin.auth.admin.inviteUserByEmail(profile.email, { redirectTo });
    if (error) throw new Error(error.message);

    await admin.from("audit_log").insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: "staff.invite_resent",
      entity_type: "staff_profile",
      entity_id: staffId,
      after: { email: profile.email },
    });
    revalidatePath("/staff/admin/staff");
  });
}

export async function updateStaffAccess(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const staffId = z.uuid().parse(formData.get("staffId"));
    const active = formData.get("isActive") === "1";
    const roleIds = ids(formData, "roleIds");
    const campusIds = ids(formData, "campusIds");
    await assertCampusScopedRolesHaveCampuses(ctx.supabase, roleIds, campusIds);

    // Guard against locking everyone out: the last active holder of the
    // super_admin role cannot be deactivated or stripped of it.
    const { data: superRole } = await ctx.supabase.from("roles").select("id").eq("code", "super_admin").single();
    if (superRole) {
      const { data: holders } = await ctx.supabase
        .from("staff_roles")
        .select("staff_id, staff_profiles!inner(is_active)")
        .eq("role_id", superRole.id)
        .eq("staff_profiles.is_active", true);
      const others = (holders ?? []).filter((h) => h.staff_id !== staffId);
      const keepsSuper = active && roleIds.includes(superRole.id);
      if (others.length === 0 && !keepsSuper) {
        throw new Error("That would leave nobody with super administrator access.");
      }
    }

    const { error } = await ctx.supabase.from("staff_profiles").update({ is_active: active, digest_enabled: formData.get("digestEnabled") === "1" }).eq("id", staffId);
    if (error) throw new Error(error.message);

    // Add before removing, and only what changed. Row-level security checks
    // the permission on every statement, so deleting a person's roles and
    // then inserting the new list would refuse the insert whenever the
    // person is editing their own row: their permission vanished with the
    // delete. That once left the only administrator with no roles at all.
    const { data: currentRoles } = await ctx.supabase.from("staff_roles").select("role_id").eq("staff_id", staffId);
    const have = new Set((currentRoles ?? []).map((r) => r.role_id));
    const addRoles = roleIds.filter((id) => !have.has(id));
    const dropRoles = [...have].filter((id) => !roleIds.includes(id));
    if (addRoles.length) {
      const { error: rErr } = await ctx.supabase.from("staff_roles").insert(addRoles.map((role_id) => ({ staff_id: staffId, role_id })));
      if (rErr) throw new Error(rErr.message);
    }
    if (dropRoles.length) {
      const { error: dErr } = await ctx.supabase.from("staff_roles").delete().eq("staff_id", staffId).in("role_id", dropRoles);
      if (dErr) throw new Error(dErr.message);
    }

    const { data: currentCampuses } = await ctx.supabase.from("staff_campuses").select("campus_id").eq("staff_id", staffId);
    const haveCampus = new Set((currentCampuses ?? []).map((c) => c.campus_id));
    const addCampuses = campusIds.filter((id) => !haveCampus.has(id));
    const dropCampuses = [...haveCampus].filter((id) => !campusIds.includes(id));
    if (addCampuses.length) {
      const { error: cErr } = await ctx.supabase.from("staff_campuses").insert(addCampuses.map((campus_id) => ({ staff_id: staffId, campus_id })));
      if (cErr) throw new Error(cErr.message);
    }
    if (dropCampuses.length) {
      const { error: cErr } = await ctx.supabase.from("staff_campuses").delete().eq("staff_id", staffId).in("campus_id", dropCampuses);
      if (cErr) throw new Error(cErr.message);
    }
    revalidatePath("/staff/admin/staff");
  });
}

export async function updateRolePermissions(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const roleId = z.uuid().parse(formData.get("roleId"));
    const codes = ids(formData, "codes").filter((c) => (PERMISSION_CODES as readonly string[]).includes(c));
    const { data: role } = await ctx.supabase.from("roles").select("code").eq("id", roleId).single();
    if (role?.code === "super_admin" && !codes.includes("admin")) {
      throw new Error("The super administrator role must keep the admin permission.");
    }
    await ctx.supabase.from("role_permissions").delete().eq("role_id", roleId);
    if (codes.length) {
      const { error } = await ctx.supabase.from("role_permissions").insert(codes.map((permission_code) => ({ role_id: roleId, permission_code })));
      if (error) throw new Error(error.message);
    }
    revalidatePath("/staff/admin/staff");
  });
}
