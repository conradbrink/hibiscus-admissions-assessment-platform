"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { normaliseMobile } from "@/lib/contacts";
import { pick, recordCrmAudit } from "@/lib/crm/audit";
import { isLifecycleStage } from "@/lib/crm/lifecycle";
import { notifyStaff } from "@/lib/crm/notifications";
import { HEARD_FROM_KEYS } from "@/lib/heard-from";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything a person does to a family from the CRM.
 *
 * Every write goes through the caller's own client, so the policies decide
 * whether this person may touch this family; the admin client is used only
 * for the audit line and the notification afterwards, which are the
 * system's to write.
 */

const TAG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const channel = z.enum(["email", "whatsapp", "phone", "sms"]).optional().or(z.literal(""));
const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

const createSchema = z.object({
  displayName: z.string().trim().min(1, "Give the family a name.").max(120),
  campusId: z.guid("Choose the campus."),
  firstName: z.string().trim().min(1, "The parent's first name is missing.").max(80),
  lastName: z.string().trim().min(1, "The parent's surname is missing.").max(80),
  email: z.string().trim().email("That is not an email address.").max(200),
  mobile: opt(40),
  relationship: z.enum(["mother", "father", "parent", "guardian", "grandparent", "other"]).default("parent"),
  leadSource: opt(40),
  leadSourceDetail: opt(200),
  preferredChannel: channel,
  preferredLanguage: opt(60),
  homeAddress: opt(500),
  notes: opt(2000),
  tags: opt(400),
  assignedStaffId: opt(60),
  referredByFamilyId: opt(60),
  marketingEmail: z.string().optional(),
  marketingWhatsapp: z.string().optional(),
  sms: z.string().optional(),
  whatsappOptIn: z.string().optional(),
  /** The person saw the duplicate warning and chose to create anyway. */
  createAnyway: z.string().optional(),
});

function tagsFrom(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,;\s]+/).map((t) => t.trim().toLowerCase()).filter((t) => TAG.test(t)))];
}

/**
 * A family typed in at the desk. The duplicate check runs here as well as
 * on the screen: a page that was not refreshed is not an excuse to create
 * the same family twice. `crm_create_family` mints the code, the contact,
 * the audit line and the outbox row.
 */
export async function createFamily(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let familyId: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = createSchema.parse(Object.fromEntries(formData));
    const mobileNormalised = p.mobile ? normaliseMobile(p.mobile) : null;
    if (p.mobile && !mobileNormalised) throw new Error("That mobile number could not be read. Use the country code, for example +267 71 234 567.");

    if (!p.createAnyway) {
      const { data: dupes } = await ctx.supabase.rpc("crm_find_duplicates", {
        p_email: p.email,
        p_mobile_normalised: mobileNormalised,
        p_last_name: p.lastName,
        p_first_name: p.firstName,
      });
      if (dupes?.length) {
        throw new Error(`Possible existing family found: ${dupes.map((d) => `${d.display_name ?? d.family_code} (${d.reason.toLowerCase()})`).join("; ")}. Use the existing family, or tick "create anyway".`);
      }
    }

    const leadSource = p.leadSource && (HEARD_FROM_KEYS as readonly string[]).includes(p.leadSource) ? p.leadSource : null;
    const { data, error } = await ctx.supabase.rpc("crm_create_family", {
      p_display_name: p.displayName,
      p_campus_id: p.campusId,
      p_first_name: p.firstName,
      p_last_name: p.lastName,
      p_email: p.email,
      p_mobile: p.mobile || null,
      p_mobile_normalised: mobileNormalised,
      p_relationship: p.relationship,
      p_lead_source: leadSource,
      p_lead_source_detail: p.leadSourceDetail || null,
      p_preferred_channel: p.preferredChannel || null,
      p_preferred_language: p.preferredLanguage || null,
      p_home_address: p.homeAddress || null,
      p_notes: p.notes || null,
      p_tags: tagsFrom(p.tags),
      p_assigned_staff_id: p.assignedStaffId || null,
      p_referred_by_family_id: p.referredByFamilyId || null,
      p_marketing_email: p.marketingEmail === "on",
      p_marketing_whatsapp: p.marketingWhatsapp === "on",
      p_sms: p.sms === "on",
      p_whatsapp_opt_in: p.whatsappOptIn === "on",
    });
    if (error) {
      if (error.message.includes("contact_email_exists")) throw new Error("A contact with that email address already exists. Search for them and add the family there.");
      if (error.message.includes("campus_not_allowed")) throw new Error("You cannot create a family at that campus.");
      throw new Error(error.message);
    }
    familyId = data;
    if (p.assignedStaffId && p.assignedStaffId !== ctx.userId) {
      await notifyStaff(createAdminClient(), p.assignedStaffId, { kind: "family_activity", title: `${p.displayName} family assigned to you`, href: `/staff/crm/families/${data}`, familyId: data });
    }
    revalidatePath("/staff/crm/families");
  });
  if (result.ok && familyId) redirect(`/staff/crm/families/${familyId}`);
  return result;
}

const updateSchema = z.object({
  familyId: z.guid(),
  displayName: z.string().trim().min(1).max(120),
  campusId: z.guid("Choose the campus."),
  homeAddress: opt(500),
  preferredChannel: channel,
  preferredLanguage: opt(60),
  leadSource: opt(40),
  leadSourceDetail: opt(200),
  assignedStaffId: opt(60),
  primaryContactId: opt(60),
  secondaryContactId: opt(60),
  referredByFamilyId: opt(60),
  referralNote: opt(300),
  tags: opt(400),
  notes: opt(4000),
  nextFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  isActive: z.string().optional(),
});

const AUDITED = ["display_name", "campus_id", "home_address", "preferred_channel", "preferred_language", "lead_source", "assigned_staff_id", "primary_contact_id", "secondary_contact_id", "referred_by_family_id", "tags", "next_follow_up_at", "is_active"] as const;

export async function updateFamily(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = updateSchema.parse(Object.fromEntries(formData));
    const { data: before } = await ctx.supabase.from("families").select("*").eq("id", p.familyId).maybeSingle();
    if (!before) throw new Error("That family is not one you can edit.");
    if (p.referredByFamilyId && p.referredByFamilyId === p.familyId) throw new Error("A family cannot refer itself.");
    const leadSource = p.leadSource && (HEARD_FROM_KEYS as readonly string[]).includes(p.leadSource) ? p.leadSource : null;
    const patch = {
      display_name: p.displayName,
      campus_id: p.campusId,
      home_address: p.homeAddress || null,
      preferred_channel: p.preferredChannel || null,
      preferred_language: p.preferredLanguage || null,
      lead_source: leadSource,
      lead_source_detail: p.leadSourceDetail || null,
      assigned_staff_id: p.assignedStaffId || null,
      primary_contact_id: p.primaryContactId || null,
      secondary_contact_id: p.secondaryContactId || null,
      referred_by_family_id: p.referredByFamilyId || null,
      referral_note: p.referralNote || null,
      tags: tagsFrom(p.tags),
      notes: p.notes || null,
      next_follow_up_at: p.nextFollowUp ? `${p.nextFollowUp}T07:00:00+02:00` : null,
      is_active: p.isActive === "on",
    };
    const { error } = await ctx.supabase.from("families").update(patch).eq("id", p.familyId);
    if (error) throw new Error(error.message);
    const { data: after } = await ctx.supabase.from("families").select("*").eq("id", p.familyId).maybeSingle();
    const admin = createAdminClient();
    await recordCrmAudit(admin, ctx.actor, { action: "family.updated", entityType: "family", entityId: p.familyId, familyId: p.familyId, before: pick(before, AUDITED), after: after ? pick(after, AUDITED) : null });
    if (patch.assigned_staff_id && patch.assigned_staff_id !== before.assigned_staff_id && patch.assigned_staff_id !== ctx.userId) {
      await notifyStaff(admin, patch.assigned_staff_id, { kind: "family_activity", title: `${p.displayName} family assigned to you`, href: `/staff/crm/families/${p.familyId}`, familyId: p.familyId });
    }
    revalidatePath(`/staff/crm/families/${p.familyId}`);
    revalidatePath("/staff/crm/families");
  });
}

/**
 * Setting the stage by hand takes it out of the sync's hands; handing it
 * back recomputes it at once. Both are audited, because "who changed the
 * lifecycle" is one of the questions the log exists to answer.
 */
export async function setLifecycle(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ familyId: z.guid(), stage: z.string(), mode: z.enum(["manual", "auto"]).default("manual") }).parse(Object.fromEntries(formData));
    const { data: before } = await ctx.supabase.from("families").select("lifecycle_stage, lifecycle_manual").eq("id", p.familyId).maybeSingle();
    if (!before) throw new Error("That family is not one you can edit.");
    const admin = createAdminClient();
    if (p.mode === "auto") {
      const { error } = await ctx.supabase.from("families").update({ lifecycle_manual: false }).eq("id", p.familyId);
      if (error) throw new Error(error.message);
      const sync = await admin.rpc("crm_sync_family", { p_family_id: p.familyId });
      if (sync.error) throw new Error(sync.error.message);
      await recordCrmAudit(admin, ctx.actor, { action: "family.lifecycle_automatic", entityType: "family", entityId: p.familyId, familyId: p.familyId, before: { lifecycle_manual: true }, after: { lifecycle_manual: false } });
    } else {
      if (!isLifecycleStage(p.stage)) throw new Error("Choose a stage.");
      const { error } = await ctx.supabase
        .from("families")
        .update({ lifecycle_stage: p.stage, lifecycle_manual: true, lifecycle_changed_at: new Date().toISOString(), is_active: p.stage !== "inactive" })
        .eq("id", p.familyId);
      if (error) throw new Error(error.message);
      await recordCrmAudit(admin, ctx.actor, { action: "family.lifecycle_changed", entityType: "family", entityId: p.familyId, familyId: p.familyId, before: { lifecycle_stage: before.lifecycle_stage }, after: { lifecycle_stage: p.stage, lifecycle_manual: true } });
    }
    revalidatePath(`/staff/crm/families/${p.familyId}`);
  });
}

export async function addFamilyNote(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ familyId: z.guid(), body: z.string().trim().min(1, "Write something.").max(4000), isPrivate: z.string().optional() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("crm_notes").insert({ family_id: p.familyId, author_staff_id: ctx.userId, body: p.body, is_private: p.isPrivate === "on" });
    if (error) throw new Error(error.message);
    await ctx.supabase.from("families").update({ last_contact_at: new Date().toISOString() }).eq("id", p.familyId);
    revalidatePath(`/staff/crm/families/${p.familyId}`);
  });
}

export async function deleteNote(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ noteId: z.guid(), familyId: z.guid().optional() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("crm_notes").delete().eq("id", p.noteId);
    if (error) throw new Error(error.message);
    if (p.familyId) revalidatePath(`/staff/crm/families/${p.familyId}`);
  });
}

/** "Yes, these are one family." The database moves everything; the person confirms first. */
export async function mergeFamilies(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let survivor: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ loserId: z.guid(), survivorId: z.guid(), confirm: z.string() }).parse(Object.fromEntries(formData));
    if (p.confirm !== "MERGE") throw new Error("Type MERGE to confirm.");
    const { error } = await ctx.supabase.rpc("crm_merge_families", { p_loser_id: p.loserId, p_survivor_id: p.survivorId });
    if (error) {
      if (error.message.includes("family_not_allowed")) throw new Error("You may not edit one of those families.");
      throw new Error(error.message);
    }
    survivor = p.survivorId;
    revalidatePath("/staff/crm/families");
  });
  if (result.ok && survivor) redirect(`/staff/crm/families/${survivor}`);
  return result;
}

export async function setFollowUp(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ familyId: z.guid(), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")) }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("families").update({ next_follow_up_at: p.on ? `${p.on}T07:00:00+02:00` : null }).eq("id", p.familyId);
    if (error) throw new Error(error.message);
    revalidatePath(`/staff/crm/families/${p.familyId}`);
  });
}

/** "I spoke to them today." Bumps last contact without writing a message. */
export async function logContact(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ familyId: z.guid(), how: z.enum(["phone", "in_person", "email", "whatsapp", "other"]), note: z.string().trim().max(2000).optional() }).parse(Object.fromEntries(formData));
    const label = { phone: "Phone call", in_person: "Spoke in person", email: "Email", whatsapp: "WhatsApp", other: "Contact" }[p.how];
    const { error } = await ctx.supabase.from("crm_notes").insert({ family_id: p.familyId, author_staff_id: ctx.userId, body: `${label}${p.note ? `: ${p.note}` : ""}` });
    if (error) throw new Error(error.message);
    await ctx.supabase.from("families").update({ last_contact_at: new Date().toISOString() }).eq("id", p.familyId);
    revalidatePath(`/staff/crm/families/${p.familyId}`);
  });
}
