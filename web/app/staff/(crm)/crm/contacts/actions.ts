"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { normaliseEmail, normaliseMobile } from "@/lib/contacts";
import { pick, recordCrmAudit } from "@/lib/crm/audit";
import { sendFamilyMessage } from "@/lib/messaging/send";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A parent or guardian: their details, and what they have agreed to.
 *
 * Consent is the one thing here the audit log must never miss, so every
 * change to any of the four flags is written before-and-after, with who
 * changed it. Nothing here sends free text on WhatsApp: the one send is an
 * approved template through the family sender, by hand, and recorded as
 * such.
 */
const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const CONSENT = ["whatsapp_opt_in", "marketing_email_consent", "marketing_whatsapp_consent", "sms_consent", "unsubscribed_at"] as const;

const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email("That is not an email address.").max(200),
  mobile: opt(40),
  relationship: z.enum(["mother", "father", "parent", "guardian", "grandparent", "other"]).default("parent"),
  preferredChannel: z.enum(["email", "whatsapp", "phone", "sms"]).optional().or(z.literal("")),
  notes: opt(2000),
  isActive: z.string().optional(),
});

export async function createContact(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let familyId: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = contactSchema.extend({ familyId: z.guid() }).parse(Object.fromEntries(formData));
    const mobileNormalised = p.mobile ? normaliseMobile(p.mobile) : null;
    if (p.mobile && !mobileNormalised) throw new Error("That mobile number could not be read. Use the country code.");
    const { data, error } = await ctx.supabase
      .from("contacts")
      .insert({
        first_name: p.firstName,
        last_name: p.lastName,
        email: p.email,
        email_normalised: normaliseEmail(p.email),
        mobile: p.mobile || null,
        mobile_normalised: mobileNormalised,
        family_id: p.familyId,
        relationship: p.relationship,
        preferred_channel: p.preferredChannel || null,
        notes: p.notes || null,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("A contact with that email address already exists.");
      throw new Error(error.message);
    }
    familyId = p.familyId;
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "contact.created", entityType: "contact", entityId: data.id, familyId: p.familyId, after: { first_name: p.firstName, last_name: p.lastName, email: p.email } });
    revalidatePath(`/staff/crm/families/${p.familyId}`);
  });
  if (result.ok && familyId) redirect(`/staff/crm/families/${familyId}`);
  return result;
}

export async function updateContact(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = contactSchema.extend({ contactId: z.guid() }).parse(Object.fromEntries(formData));
    const { data: before } = await ctx.supabase.from("contacts").select("*").eq("id", p.contactId).maybeSingle();
    if (!before) throw new Error("That contact is not one you can edit.");
    const mobileNormalised = p.mobile ? normaliseMobile(p.mobile) : null;
    if (p.mobile && !mobileNormalised) throw new Error("That mobile number could not be read. Use the country code.");
    const patch = {
      first_name: p.firstName,
      last_name: p.lastName,
      email: p.email,
      email_normalised: normaliseEmail(p.email),
      mobile: p.mobile || null,
      mobile_normalised: mobileNormalised,
      relationship: p.relationship,
      preferred_channel: p.preferredChannel || null,
      notes: p.notes || null,
      is_active: p.isActive === "on",
    };
    const { error } = await ctx.supabase.from("contacts").update(patch).eq("id", p.contactId);
    if (error) {
      if (error.code === "23505") throw new Error("Another contact already has that email address.");
      throw new Error(error.message);
    }
    const keys = ["first_name", "last_name", "email", "mobile", "relationship", "preferred_channel", "is_active"] as const;
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "contact.updated", entityType: "contact", entityId: p.contactId, familyId: before.family_id, before: pick(before, keys), after: pick({ ...before, ...patch }, keys) });
    revalidatePath(`/staff/crm/contacts/${p.contactId}`);
    if (before.family_id) revalidatePath(`/staff/crm/families/${before.family_id}`);
  });
}

/** The four flags, each recorded with when and by whom. Unticking marketing email also clears an unsubscribe, which is the parent changing their mind through us. */
export async function setConsent(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ contactId: z.guid(), whatsappOptIn: z.string().optional(), marketingEmail: z.string().optional(), marketingWhatsapp: z.string().optional(), sms: z.string().optional() }).parse(Object.fromEntries(formData));
    const { data: before } = await ctx.supabase.from("contacts").select("*").eq("id", p.contactId).maybeSingle();
    if (!before) throw new Error("That contact is not one you can edit.");
    const now = new Date().toISOString();
    const next = {
      whatsapp_opt_in: p.whatsappOptIn === "on",
      marketing_email_consent: p.marketingEmail === "on",
      marketing_whatsapp_consent: p.marketingWhatsapp === "on",
      sms_consent: p.sms === "on",
    };
    const patch = {
      ...next,
      whatsapp_opt_in_at: next.whatsapp_opt_in && !before.whatsapp_opt_in ? now : before.whatsapp_opt_in_at,
      whatsapp_opt_out_at: !next.whatsapp_opt_in && before.whatsapp_opt_in ? now : before.whatsapp_opt_out_at,
      whatsapp_opt_in_source: next.whatsapp_opt_in && !before.whatsapp_opt_in ? ("staff" as const) : before.whatsapp_opt_in_source,
      marketing_email_consent_at: next.marketing_email_consent !== before.marketing_email_consent ? now : before.marketing_email_consent_at,
      marketing_whatsapp_consent_at: next.marketing_whatsapp_consent !== before.marketing_whatsapp_consent ? now : before.marketing_whatsapp_consent_at,
      sms_consent_at: next.sms_consent !== before.sms_consent ? now : before.sms_consent_at,
      unsubscribed_at: next.marketing_email_consent ? null : before.unsubscribed_at,
      consent_source: "staff" as const,
    };
    const { error } = await ctx.supabase.from("contacts").update(patch).eq("id", p.contactId);
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "consent.changed", entityType: "consent", entityId: p.contactId, familyId: before.family_id, before: pick(before, CONSENT), after: pick({ ...before, ...patch }, CONSENT) });
    revalidatePath(`/staff/crm/contacts/${p.contactId}`);
    if (before.family_id) revalidatePath(`/staff/crm/families/${before.family_id}`);
  });
}

/**
 * An approved family template, by hand, to one contact. The sender applies
 * every rule; this checks the person may see the contact, names them on the
 * message, and drains the queue so a reply's task can follow.
 */
export async function sendWhatsAppToContact(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ contactId: z.guid(), templateKey: z.string().regex(/^[a-z0-9_]+$/) }).parse(Object.fromEntries(formData));
    const { data: contact } = await ctx.supabase.from("contacts").select("id, family_id, first_name, families!contacts_family_id_fkey(display_name, campuses!families_campus_id_fkey(name))").eq("id", p.contactId).maybeSingle();
    if (!contact?.family_id) throw new Error("That contact is not one you can message.");
    const fam = Array.isArray(contact.families) ? contact.families[0] : contact.families;
    const campus = fam ? (Array.isArray(fam.campuses) ? fam.campuses[0] : fam.campuses) : null;
    const { data: student } = await ctx.supabase.from("students").select("preferred_name, legal_first_name").eq("family_id", contact.family_id).in("status", ["onboarding", "active"]).order("date_of_birth", { ascending: false }).limit(1).maybeSingle();
    const admin = createAdminClient();
    const result = await sendFamilyMessage(admin, {
      familyId: contact.family_id,
      contactId: contact.id,
      templateKey: p.templateKey,
      idempotencyKey: `whatsapp:crm:${contact.id}:${p.templateKey}:${Math.floor(Date.now() / 60_000)}`,
      variables: {
        family_name: fam?.display_name ?? null,
        campus: campus?.name ?? "Hibiscus",
        student_first_name: student ? student.preferred_name || student.legal_first_name : null,
      },
      link: "family",
      trigger: "manual",
      actorId: ctx.userId,
      actorLabel: ctx.profile.email,
    });
    if (result.status === "failed") throw new Error(`WhatsApp could not be sent: ${result.error}`);
    if (result.status === "skipped") throw new Error(`Not sent: ${result.reason}.`);
    await recordCrmAudit(admin, ctx.actor, { action: "whatsapp.sent_by_hand", entityType: "contact", entityId: contact.id, familyId: contact.family_id, after: { template_key: p.templateKey } });
    drainSoon();
    revalidatePath(`/staff/crm/families/${contact.family_id}`);
    revalidatePath(`/staff/crm/whatsapp`);
  });
}
