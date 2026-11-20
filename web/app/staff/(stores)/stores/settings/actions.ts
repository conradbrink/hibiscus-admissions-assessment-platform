"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sendStaffEmail } from "@/lib/email/send";
import { mintStaffInvite } from "@/lib/staff/invites";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { storesErrorMessage } from "@/lib/stores/rules";
import { rpcResult, storesGuarded, type StoresActionState } from "@/lib/stores/server";

const TABLES = { departments: "stores_departments", categories: "stores_categories", locations: "stores_locations" } as const;
type ListKey = keyof typeof TABLES;

/**
 * Adds or renames a department, category or storage place, or switches one
 * off. Never a delete: transactions name these rows, and a name that is in
 * history must stay readable there.
 */
export async function saveNamed(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.admin");
    const list = z.enum(["departments", "categories", "locations"]).parse(formData.get("list")) as ListKey;
    const name = z.string().trim().min(1, "Enter a name.").max(80).safeParse(formData.get("name"));
    if (!name.success) throw new Error(name.error.issues[0]?.message ?? "Enter a name.");
    const id = String(formData.get("id") ?? "");
    const table = TABLES[list];
    const isActive = formData.get("isActive") !== null ? formData.get("isActive") === "on" : true;
    if (id) {
      const { data, error } = await ctx.supabase.from(table).update({ name: name.data, is_active: isActive }).eq("id", z.guid().parse(id)).select("id").maybeSingle();
      if (error) throw new Error(storesErrorMessage(error));
      if (!data) throw new Error("That entry was not found.");
    } else {
      const { error } = await ctx.supabase.from(table).insert({ name: name.data });
      if (error) throw new Error(storesErrorMessage(error));
    }
    revalidatePath("/staff/stores", "layout");
    return { message: id ? "Saved." : `${name.data} added.` };
  });
}

/** Switches an item back on. Switching off happens on the item's own page. */
export async function reactivateItem(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.admin");
    const id = z.guid().parse(formData.get("id"));
    const { error } = await ctx.supabase.from("stores_items").update({ is_active: true }).eq("id", id);
    if (error) throw new Error(storesErrorMessage(error));
    revalidatePath("/staff/stores", "layout");
    return { message: "Switched on." };
  });
}

const ROLE = z.enum(["storekeeper", "stores_admin"]);

/**
 * Gives or takes away one of the two Stores roles. The database function does
 * the checking — a Stores administrator, never on their own account, and
 * nothing but these two roles — so a request that skips this screen is
 * refused there too.
 */
export async function setStoresRole(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.admin");
    const staffId = z.guid().parse(formData.get("staffId"));
    const role = ROLE.parse(formData.get("role"));
    const granted = formData.get("granted") === "1";
    await rpcResult(ctx.supabase.rpc("stores_set_role", { p_staff_id: staffId, p_role_code: role, p_granted: granted }));
    revalidatePath("/staff/stores/settings/users");
    return { message: granted ? "Access given." : "Access removed." };
  });
}

/**
 * Invites somebody new to sign in to Stores, with one Stores role and nothing
 * else. An address that already has an account is refused rather than
 * reused: that person may have been switched off on purpose, and inviting
 * them again here must not switch them back on. Give an existing account its
 * Stores role from the list instead.
 */
export async function inviteStoresUser(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.admin");
    const p = z
      .object({ email: z.email("Enter an email address."), fullName: z.string().trim().min(2, "Enter their full name.").max(120), role: ROLE })
      .safeParse({ email: String(formData.get("email") ?? "").trim().toLowerCase(), fullName: formData.get("fullName"), role: formData.get("role") });
    if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Check the form.");
    const admin = createAdminClient();
    const { data: existing } = await admin.from("staff_profiles").select("id").ilike("email", p.data.email).maybeSingle();
    if (existing) throw new Error("That person already has an account. Give them access from the list below instead.");
    const { data: role } = await admin.from("roles").select("id").eq("code", p.data.role).single();
    if (!role) throw new Error("The Stores roles are missing. Ask a super administrator.");

    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: p.data.email, email_confirm: true, password: randomBytes(24).toString("base64url") });
    if (cErr || !created.user) throw new Error(cErr?.message.includes("already") ? "That email address is already registered. Ask a super administrator." : "Could not create the account.");
    const userId = created.user.id;
    const { error: pErr } = await admin.from("staff_profiles").insert({ id: userId, full_name: p.data.fullName, email: p.data.email, is_active: true });
    if (pErr) throw new Error(storesErrorMessage(pErr));
    const { error: rErr } = await admin.from("staff_roles").insert({ staff_id: userId, role_id: role.id });
    if (rErr) throw new Error(storesErrorMessage(rErr));

    const { url } = await mintStaffInvite(admin, userId, ctx.userId);
    const sent = await sendStaffEmail(admin, {
      staffId: userId,
      templateKey: "staff_invite",
      variables: {
        staff_first_name: p.data.fullName.split(" ")[0] || "there",
        inviter_name: ctx.profile.full_name,
        invite_link: url,
        console_link: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/staff/stores`,
      },
      idempotencyKey: `staff_invite:${userId}:${Date.now()}`,
    });
    await admin.from("audit_log").insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: "staff.invited",
      entity_type: "staff_profile",
      entity_id: userId,
      after: { email: p.data.email, roles: [p.data.role], via: "stores" },
    });
    revalidatePath("/staff/stores/settings/users");
    if (sent.status === "failed") return { message: `The account was made but the invitation email did not send: ${sent.error}. A super administrator can resend it from Staff and roles.` };
    return { message: `Invitation sent to ${p.data.email}.` };
  });
}
