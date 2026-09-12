"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { sendStaffEmail } from "@/lib/email/send";
import { mintStaffInvite } from "@/lib/staff/invites";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction, type StaffContext } from "@/lib/staff/session";
import { can, PERMISSION_CODES, type PermissionCode } from "@/lib/permissions";

function ids(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Nobody hands out more than they hold. Without this, a person who may
 * manage staff invites a second account for themselves, makes it a super
 * administrator, and signs in as it — so `staff.write` would quietly be
 * `admin`. The database enforces the same rule on `staff_roles`
 * (`can_grant_role`); this is here because inviting goes through the service
 * role, where row-level security does not apply, and because the message is
 * better than a policy refusal.
 */
async function assertRolesWithinCeiling(ctx: StaffContext, roleIds: string[]): Promise<void> {
  if (!roleIds.length || can(ctx.permissions, "admin")) return;
  const { data, error } = await ctx.supabase
    .from("role_permissions")
    .select("role_id, permission_code, roles!inner(name)")
    .in("role_id", roleIds);
  if (error) throw new Error(error.message);
  const tooHigh = new Map<string, string[]>();
  for (const row of data ?? []) {
    if (can(ctx.permissions, row.permission_code as PermissionCode)) continue;
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    const name = (role as { name: string } | null)?.name ?? "that role";
    tooHigh.set(name, [...(tooHigh.get(name) ?? []), row.permission_code]);
  }
  if (tooHigh.size) {
    const [name, codes] = [...tooHigh.entries()][0];
    throw new Error(
      `You cannot give somebody ${name}: it carries ${codes.join(", ")}, which you do not have yourself. Ask a super administrator.`
    );
  }
}

/**
 * Changing your own roles or campus scope is how a limited account becomes
 * an unlimited one, so it belongs to whoever may edit the matrix in the
 * first place. Everything else on your own row — your name, the morning
 * digest — is still yours to change.
 */
function assertNotSelfPromotion(ctx: StaffContext, staffId: string, changing: boolean): void {
  if (!changing || staffId !== ctx.userId || can(ctx.permissions, "roles.write")) return;
  throw new Error("You cannot change your own roles or campuses. Ask a super administrator.");
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
 * Sends the invitation email carrying our own link. Split out because both
 * inviting and resending do exactly this.
 */
async function sendInvite(
  admin: ReturnType<typeof createAdminClient>,
  staffId: string,
  inviterName: string,
  inviterId: string | null
): Promise<void> {
  const { url } = await mintStaffInvite(admin, staffId, inviterId);
  const { data: profile } = await admin.from("staff_profiles").select("full_name").eq("id", staffId).single();
  const result = await sendStaffEmail(admin, {
    staffId,
    templateKey: "staff_invite",
    variables: {
      staff_first_name: (profile?.full_name ?? "").split(" ")[0] || "there",
      inviter_name: inviterName,
      invite_link: url,
      console_link: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/staff`,
    },
    idempotencyKey: `staff_invite:${staffId}:${Date.now()}`,
  });
  if (result.status === "failed") throw new Error(`The account was saved but the email did not send: ${result.error}`);
}

/**
 * Invites a member of staff: the auth user, the profile, the roles, and an
 * email carrying a link that does not expire. The auth part needs the
 * service role, which is why this is one of the few staff actions that uses
 * it. Supabase's own invite email is not used: its link lasts a day and is
 * spent by the first request to reach it, including a mail scanner's.
 */
export async function inviteStaff(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const p = z
      .object({ email: z.email(), fullName: z.string().trim().min(1).max(120) })
      .parse({ email: formData.get("email"), fullName: formData.get("fullName") });
    const roleIds = ids(formData, "roleIds");
    const campusIds = ids(formData, "campusIds");
    await assertRolesWithinCeiling(ctx, roleIds);

    const admin = createAdminClient();
    await assertCampusScopedRolesHaveCampuses(admin, roleIds, campusIds);
    const userId = await ensureAuthUser(admin, p.email);

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
    await sendInvite(admin, userId, ctx.profile.full_name, ctx.userId);
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
 * The auth user behind a member of staff. Created confirmed: the invitation
 * link is what proves the address, and an unconfirmed user cannot sign in at
 * all. An address that already has an account (someone re-invited after
 * being removed) is reused rather than refused.
 */
async function ensureAuthUser(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    // Never used: the invitation sets the real one, and until then there is
    // nothing to guess.
    password: randomBytes(24).toString("base64url"),
  });
  if (!error && data.user) return data.user.id;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;
  throw new Error(error?.message ?? "Could not create the account.");
}

/**
 * Sends the invitation again, replacing the previous link. Anyone who has
 * not signed in yet can be sent one; someone who has should use "Forgot
 * password" instead, so the button only shows before the first sign-in and
 * the guard here repeats that check server-side.
 */
export async function resendInvite(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const { staffId } = z.object({ staffId: z.guid() }).parse({ staffId: formData.get("staffId") });

    const admin = createAdminClient();
    const { data: profile } = await admin.from("staff_profiles").select("id, email, is_active").eq("id", staffId).single();
    if (!profile) throw new Error("That member of staff no longer exists.");
    if (!profile.is_active) throw new Error("This person is deactivated. Tick \"Can sign in\" and save first.");
    const { data: user } = await admin.auth.admin.getUserById(staffId);
    if (user.user?.last_sign_in_at) throw new Error("This person has already signed in. They can reset their password from the sign-in page.");

    await sendInvite(admin, staffId, ctx.profile.full_name, ctx.userId);

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

/**
 * Where a person leaves a trace of something they did. Deleting someone who
 * appears here would either blank the "who" on records (the columns are
 * `on delete set null`) or, for notes, remove their notes outright; such a
 * person is deactivated instead. Assignments (owner of an application,
 * assignee of a task, assessor of a session, recipient of a digest) are not
 * history: they are cleared by the delete and listed in the audit row.
 */
const STAFF_HISTORY: ReadonlyArray<{ table: string; column: string; label: string }> = [
  { table: "admission_decisions", column: "staff_id", label: "decisions" },
  { table: "offers", column: "approved_by", label: "approved offers" },
  { table: "payments", column: "recorded_by", label: "recorded payments" },
  { table: "payments", column: "refunded_by", label: "refunds" },
  { table: "notes", column: "author_staff_id", label: "notes" },
  { table: "attempts", column: "launched_by", label: "launched sittings" },
  { table: "attempt_responses", column: "marked_by", label: "marked answers" },
  { table: "bookings", column: "checked_in_by", label: "check-ins" },
  { table: "documents", column: "reviewed_by", label: "reviewed documents" },
  { table: "documents", column: "uploaded_by_staff_id", label: "uploaded documents" },
  { table: "application_promotions", column: "applied_by", label: "applied promotions" },
  { table: "tasks", column: "resolved_by", label: "resolved tasks" },
  { table: "tasks", column: "created_by", label: "created tasks" },
  { table: "sessions", column: "created_by", label: "created sessions" },
  { table: "school_closures", column: "created_by", label: "school closures" },
  { table: "student_records", column: "generated_by", label: "student records" },
  { table: "student_exports", column: "created_by", label: "exports" },
  { table: "application_summaries", column: "generated_by", label: "summaries" },
  { table: "settings", column: "updated_by", label: "settings changes" },
  { table: "promotions", column: "created_by", label: "promotions" },
  { table: "admission_rulesets", column: "created_by", label: "rulesets" },
  { table: "admission_rulesets", column: "activated_by", label: "activated rulesets" },
  { table: "assessment_templates", column: "created_by", label: "assessment templates" },
  { table: "question_banks", column: "created_by", label: "question banks" },
  { table: "questions", column: "created_by", label: "questions" },
  { table: "email_templates", column: "created_by", label: "email templates" },
  { table: "offer_templates", column: "created_by", label: "offer templates" },
  { table: "agreement_templates", column: "created_by", label: "agreements" },
  { table: "message_templates", column: "updated_by", label: "WhatsApp templates" },
];

/** Cleared, not counted: the foreign keys are `on delete set null`. */
const STAFF_ASSIGNMENTS: ReadonlyArray<{ table: string; column: string; label: string }> = [
  { table: "applications", column: "owner_staff_id", label: "owned applications" },
  { table: "tasks", column: "assignee_staff_id", label: "assigned tasks" },
  { table: "sessions", column: "assessor_staff_id", label: "sessions as assessor" },
  { table: "email_messages", column: "recipient_staff_id", label: "staff emails" },
];

/**
 * Removes a person entirely: the sign-in, the profile, their roles and
 * campuses. Only for someone with no history in the system (a wrong email,
 * a test account, an invitation that was never accepted); anyone who has
 * decided, approved, marked or recorded anything is deactivated instead,
 * so the record of who did what stays intact.
 */
/**
 * Clear somebody's authenticator, because the phone it lived on is gone.
 *
 * This is the escape hatch the whole rollout rests on: without it, a lost
 * phone is an account nobody can reach, and a school of thirty would rather
 * turn the second factor off than live with that. It is also, for exactly the
 * same reason, the most attractive action in the console to an attacker — it
 * is the supported way to take a second lock off an account.
 *
 * So: `staff.write`, never on yourself (removing your own goes through Set up
 * → My security, which needs your current code), and a line in the
 * append-only log naming who did it and to whom.
 *
 * The person is left with a password only, and must set a new authenticator
 * up the next time they sign in — immediately, if the school requires one.
 */
export async function resetStaffMfa(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const { staffId } = z.object({ staffId: z.guid() }).parse({ staffId: formData.get("staffId") });
    // Your own is not an administrative act, and letting it be one would mean
    // a stolen session could strip its own second factor without a code.
    if (staffId === ctx.userId) {
      throw new Error("To change your own, go to Set up → My security. You will need your current code.");
    }

    const admin = createAdminClient();
    const { data: profile } = await admin.from("staff_profiles").select("id, email, full_name").eq("id", staffId).single();
    if (!profile) throw new Error("That member of staff no longer exists.");

    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: staffId });
    if (listError) throw new Error(listError.message);
    const all = factors?.factors ?? [];
    if (!all.length) throw new Error(`${profile.full_name} has no authenticator set up.`);

    for (const factor of all) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: staffId, id: factor.id });
      if (error) throw new Error(error.message);
    }

    await admin.from("audit_log").insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: "staff.mfa_reset",
      entity_type: "staff_profile",
      entity_id: staffId,
      after: { email: profile.email, factors_removed: all.length },
    });

    revalidatePath("/staff/admin/staff");
  });
}

export async function deleteStaff(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.delete");
    const { staffId } = z.object({ staffId: z.guid() }).parse({ staffId: formData.get("staffId") });
    if (staffId === ctx.userId) throw new Error("You cannot delete your own account.");

    const admin = createAdminClient();
    const { data: profile } = await admin.from("staff_profiles").select("id, email, full_name").eq("id", staffId).single();
    if (!profile) throw new Error("That member of staff no longer exists.");

    const { data: superRole } = await admin.from("roles").select("id").eq("code", "super_admin").single();
    if (superRole) {
      const { data: holders } = await admin
        .from("staff_roles")
        .select("staff_id, staff_profiles!inner(is_active)")
        .eq("role_id", superRole.id)
        .eq("staff_profiles.is_active", true);
      if ((holders ?? []).some((h) => h.staff_id === staffId) && (holders ?? []).every((h) => h.staff_id === staffId)) {
        throw new Error("That would leave nobody with super administrator access.");
      }
    }

    // The typed client wants literal table names; this walk is over a fixed
    // list, so the untyped view of the same client is used for the counts.
    const loose = admin as unknown as SupabaseClient;
    const found: string[] = [];
    for (const ref of STAFF_HISTORY) {
      const { count, error } = await loose.from(ref.table).select("*", { count: "exact", head: true }).eq(ref.column, staffId);
      if (error) throw new Error(error.message);
      if (count) found.push(`${count} ${ref.label}`);
    }
    if (found.length) {
      throw new Error(`${profile.full_name} has history here (${found.join(", ")}), so the record must stay. Untick "Can sign in" and save to remove their access instead.`);
    }
    const cleared: Record<string, number> = {};
    for (const ref of STAFF_ASSIGNMENTS) {
      const { count } = await loose.from(ref.table).select("*", { count: "exact", head: true }).eq(ref.column, staffId);
      if (count) cleared[ref.label] = count;
    }

    // The auth user is the parent row: the profile, roles and campuses
    // cascade from it. The audit row is written first so it exists even if
    // something below fails halfway.
    await admin.from("audit_log").insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: "staff.deleted",
      entity_type: "staff_profile",
      entity_id: staffId,
      before: { email: profile.email, full_name: profile.full_name },
      after: { cleared },
    });
    const { error } = await admin.auth.admin.deleteUser(staffId);
    if (error) throw new Error(error.message);
    // Belt and braces: a profile that outlived its auth row (it should not).
    await admin.from("staff_profiles").delete().eq("id", staffId);
    revalidatePath("/staff/admin/staff");
  });
}

export async function updateStaffAccess(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("staff.write");
    const staffId = z.guid().parse(formData.get("staffId"));
    const active = formData.get("isActive") === "1";
    const roleIds = ids(formData, "roleIds");
    const campusIds = ids(formData, "campusIds");
    await assertCampusScopedRolesHaveCampuses(ctx.supabase, roleIds, campusIds);

    // What is actually changing decides what is allowed: saving your own row
    // with the same roles is fine, promoting yourself is not.
    const [{ data: hasRoles }, { data: hasCampuses }] = await Promise.all([
      ctx.supabase.from("staff_roles").select("role_id").eq("staff_id", staffId),
      ctx.supabase.from("staff_campuses").select("campus_id").eq("staff_id", staffId),
    ]);
    const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
    const rolesChanging = !same((hasRoles ?? []).map((r) => r.role_id), roleIds);
    const campusesChanging = !same((hasCampuses ?? []).map((c) => c.campus_id), campusIds);
    assertNotSelfPromotion(ctx, staffId, rolesChanging || campusesChanging);
    // Only the roles being added or taken away need to be within reach; a
    // role the person already has and keeps is not being handed out.
    const touched = [
      ...roleIds.filter((id) => !(hasRoles ?? []).some((r) => r.role_id === id)),
      ...(hasRoles ?? []).map((r) => r.role_id).filter((id) => !roleIds.includes(id)),
    ];
    await assertRolesWithinCeiling(ctx, touched);

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
    const ctx = await requireStaffAction("roles.write");
    const roleId = z.guid().parse(formData.get("roleId"));
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
