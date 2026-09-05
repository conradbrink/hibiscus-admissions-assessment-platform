"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { PERMISSION_CODES } from "@/lib/permissions";

function ids(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string" && v.length > 0);
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

export async function updateStaffAccess(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const staffId = z.uuid().parse(formData.get("staffId"));
    const active = formData.get("isActive") === "1";
    const roleIds = ids(formData, "roleIds");
    const campusIds = ids(formData, "campusIds");

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

    const { error } = await ctx.supabase.from("staff_profiles").update({ is_active: active }).eq("id", staffId);
    if (error) throw new Error(error.message);
    await ctx.supabase.from("staff_roles").delete().eq("staff_id", staffId);
    if (roleIds.length) {
      const { error: rErr } = await ctx.supabase.from("staff_roles").insert(roleIds.map((role_id) => ({ staff_id: staffId, role_id })));
      if (rErr) throw new Error(rErr.message);
    }
    await ctx.supabase.from("staff_campuses").delete().eq("staff_id", staffId);
    if (campusIds.length) {
      await ctx.supabase.from("staff_campuses").insert(campusIds.map((campus_id) => ({ staff_id: staffId, campus_id })));
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
