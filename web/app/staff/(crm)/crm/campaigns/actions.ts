"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { recordCrmAudit } from "@/lib/crm/audit";
import { prepareCampaign } from "@/lib/crm/campaigns/prepare";
import { queueCampaignSend } from "@/lib/crm/campaigns/send";
import { textToHtml, validateCampaignBody } from "@/lib/crm/campaigns/variables";
import { SENSITIVE_CATEGORIES } from "@/lib/crm/labels";
import { notifyPermissionHolders, notifyStaff } from "@/lib/crm/notifications";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CampaignCategory, CampaignRow, Json } from "@/lib/supabase/types";

/**
 * The campaign workflow, one action per step: write it, prepare the list,
 * submit it, approve or send it back, schedule it or send it now, pause,
 * cancel. The database's trigger (`campaigns_guard_transition`) is the
 * referee for every move; these actions ask politely and translate a
 * refusal into a sentence.
 */

const CATEGORIES = ["general", "promotion", "event", "reenrolment", "fee_notice", "policy", "announcement"] as const;

const draftSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(160),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  campusId: z.string().optional().or(z.literal("")),
  segmentId: z.guid("Choose the audience."),
  eventId: z.string().optional().or(z.literal("")),
  channel: z.enum(["email", "whatsapp", "both"]),
  category: z.enum(CATEGORIES).default("general"),
  emailSubject: z.string().trim().max(200).optional().or(z.literal("")),
  emailBody: z.string().trim().max(20000).optional().or(z.literal("")),
  messageTemplateKey: z.string().optional().or(z.literal("")),
});

function contentFrom(p: z.infer<typeof draftSchema>) {
  const wantsEmail = p.channel === "email" || p.channel === "both";
  const wantsWhatsApp = p.channel === "whatsapp" || p.channel === "both";
  if (wantsEmail && (!p.emailSubject || !p.emailBody)) throw new Error("An email campaign needs a subject and a message.");
  if (wantsWhatsApp && !p.messageTemplateKey) throw new Error("A WhatsApp campaign needs an approved template.");
  const html = wantsEmail ? textToHtml(p.emailBody!) : null;
  const text = wantsEmail ? p.emailBody! : null;
  if (wantsEmail) {
    const problems = validateCampaignBody(p.emailSubject!, html!, text!);
    if (problems.length) throw new Error(`The message uses something it may not: ${problems.map((x) => (x.kind === "unknown_variable" ? `{{${x.name}}}` : "an unclosed {{#if}}")).join(", ")}.`);
  }
  return {
    email_subject: wantsEmail ? p.emailSubject! : null,
    email_body_html: html,
    email_body_text: text,
    message_template_key: wantsWhatsApp ? p.messageTemplateKey! : null,
  };
}

async function refuse(e: { message: string }): Promise<never> {
  const m = e.message;
  if (m.includes("campaign_self_approval")) throw new Error("A campaign must be approved by somebody other than the person who wrote it.");
  if (m.includes("campaign_needs_sensitive_approval")) throw new Error("Fee, policy and group-wide campaigns need approval from somebody who may approve sensitive communications.");
  if (m.includes("campaign_not_approved")) throw new Error("The campaign has to be approved before it can be scheduled or sent.");
  if (m.includes("campaign_locked")) throw new Error("The message cannot be changed once it has been submitted. Send it back to draft first.");
  if (m.includes("campaign_status_engine_only")) throw new Error("Sending is the system's job: schedule it, or press Send now.");
  if (m.includes("campaign_needs_a_time")) throw new Error("Choose when to send it.");
  if (m.includes("campaign_not_awaiting_approval")) throw new Error("This campaign is not waiting for approval.");
  if (m.includes("campaign_already_sent")) throw new Error("This campaign has already been sent.");
  if (m.includes("permission_denied")) throw new Error("You do not have permission to do that.");
  throw new Error(m);
}

export async function createCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let id: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.campaigns.write");
    const p = draftSchema.parse(Object.fromEntries(formData));
    const content = contentFrom(p);
    const { data, error } = await ctx.supabase
      .from("campaigns")
      .insert({
        name: p.name,
        description: p.description || null,
        campus_id: p.campusId || null,
        segment_id: p.segmentId,
        event_id: p.eventId || null,
        channel: p.channel,
        category: p.category,
        ...content,
        status: "draft",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id;
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "campaign.created", entityType: "campaign", entityId: data.id, after: { name: p.name, channel: p.channel, category: p.category, segment_id: p.segmentId } });
    revalidatePath("/staff/crm/campaigns");
  });
  if (result.ok && id) redirect(`/staff/crm/campaigns/${id}`);
  return result;
}

export async function updateCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.campaigns.write");
    const { campaignId } = z.object({ campaignId: z.guid() }).parse(Object.fromEntries(formData));
    const p = draftSchema.parse(Object.fromEntries(formData));
    const content = contentFrom(p);
    const { error } = await ctx.supabase
      .from("campaigns")
      .update({ name: p.name, description: p.description || null, campus_id: p.campusId || null, segment_id: p.segmentId, event_id: p.eventId || null, channel: p.channel, category: p.category, ...content, prepared_at: null, recipients_total: null, recipients_email: null, recipients_whatsapp: null, excluded_count: null, exclusions: {} })
      .eq("id", campaignId);
    if (error) await refuse(error);
    revalidatePath(`/staff/crm/campaigns/${campaignId}`);
  });
}

/** Freezes the recipient list and the counts the approver reads. */
export async function prepare(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.campaigns.write");
    const { campaignId } = z.object({ campaignId: z.guid() }).parse(Object.fromEntries(formData));
    const { data: campaign } = await ctx.supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
    if (!campaign) throw new Error("That campaign is not one you can see.");
    if (campaign.status === "sending" || campaign.status === "sent") throw new Error("The list is frozen once sending has started.");
    const plan = await prepareCampaign(ctx.supabase, createAdminClient(), campaign);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "campaign.prepared", entityType: "campaign", entityId: campaignId, after: { families: plan.familiesReached, email: plan.email, whatsapp: plan.whatsapp, excluded: plan.exclusionSummary as unknown as Json } });
    revalidatePath(`/staff/crm/campaigns/${campaignId}`);
  });
}

async function move(formData: FormData, permission: "crm.campaigns.write" | "crm.campaigns.approve", to: CampaignRow["status"], extra: Record<string, unknown> = {}) {
  const ctx = await requireStaffAction(permission);
  const { campaignId } = z.object({ campaignId: z.guid() }).parse(Object.fromEntries(formData));
  const { data: before } = await ctx.supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!before) throw new Error("That campaign is not one you can see.");
  const { error } = await ctx.supabase.from("campaigns").update({ status: to, ...extra }).eq("id", campaignId);
  if (error) await refuse(error);
  revalidatePath(`/staff/crm/campaigns/${campaignId}`);
  revalidatePath("/staff/crm/campaigns");
  return { ctx, before };
}

export async function submitForApproval(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx0 = await requireStaffAction("crm.campaigns.write");
    const { campaignId } = z.object({ campaignId: z.guid() }).parse(Object.fromEntries(formData));
    const { data: c } = await ctx0.supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
    if (!c) throw new Error("That campaign is not one you can see.");
    if (!c.prepared_at) throw new Error("Prepare the recipient list first, so the approver can see who it goes to.");
    if ((c.recipients_email ?? 0) + (c.recipients_whatsapp ?? 0) === 0) throw new Error("Nobody would receive this campaign. Check the segment and the consent of the families in it.");
    const settings = await getSettings(ctx0.supabase);
    // With the approval setting off, someone who may approve goes straight
    // to approved; everyone else still waits for one.
    const straight = !settings.crmCampaignApprovalRequired && can(ctx0.permissions, "crm.campaigns.approve") && (!SENSITIVE_CATEGORIES.has(c.category as CampaignCategory) || can(ctx0.permissions, "crm.campaigns.approve_sensitive"));
    const { ctx } = await move(formData, "crm.campaigns.write", straight ? "approved" : "pending_approval");
    if (!straight) {
      const admin = createAdminClient();
      const permission = SENSITIVE_CATEGORIES.has(c.category as CampaignCategory) ? "crm.campaigns.approve_sensitive" : "crm.campaigns.approve";
      await notifyPermissionHolders(admin, permission, { kind: "campaign_approval_requested", title: `"${c.name}" is waiting for your approval`, body: `${c.recipients_total ?? 0} families · ${c.channel} · ${c.category}`, href: `/staff/crm/campaigns/${c.id}` }, ctx.userId);
    }
  });
}

export async function approveCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
    const { before } = await move(formData, "crm.campaigns.approve", "approved", { approval_note: note });
    await notifyStaff(createAdminClient(), before.created_by, { kind: "campaign_approved", title: `"${before.name}" was approved`, body: note, href: `/staff/crm/campaigns/${before.id}` });
  });
}

export async function rejectCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
    if (!reason) throw new Error("Say why it is being sent back.");
    const ctx = await requireStaffAction("crm.campaigns.approve");
    const { before } = await move(formData, "crm.campaigns.approve", "draft", { rejected_by: ctx.userId, rejected_at: new Date().toISOString(), rejection_reason: reason });
    await notifyStaff(createAdminClient(), before.created_by, { kind: "campaign_rejected", title: `"${before.name}" was sent back`, body: reason, href: `/staff/crm/campaigns/${before.id}` });
  });
}

export async function backToDraft(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    await move(formData, "crm.campaigns.write", "draft");
  });
}

export async function scheduleCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const at = String(formData.get("scheduledAt") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new Error("Choose a date and time.");
    const iso = `${at}:00+02:00`;
    if (new Date(iso).getTime() < Date.now() - 60_000) throw new Error("That time has passed. Press Send now instead.");
    await move(formData, "crm.campaigns.write", "scheduled", { scheduled_at: iso });
  });
}

/** Approved, confirmed, and off it goes: the first batch is queued and the drain runs. */
export async function sendNow(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const confirm = String(formData.get("confirm") ?? "");
    if (confirm !== "SEND") throw new Error("Type SEND to confirm.");
    const { ctx, before } = await move(formData, "crm.campaigns.write", "scheduled", { scheduled_at: new Date().toISOString() });
    const admin = createAdminClient();
    await queueCampaignSend(admin, before.id, 0);
    await recordCrmAudit(admin, ctx.actor, { action: "campaign.send_requested", entityType: "campaign", entityId: before.id, after: { recipients_total: before.recipients_total } });
    drainSoon();
  });
}

export async function pauseCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    await move(formData, "crm.campaigns.write", "paused");
  });
}

/** Paused and picked up again: still approved, so back to scheduled and queued. */
export async function resumeCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const { before } = await move(formData, "crm.campaigns.write", "scheduled", { scheduled_at: new Date().toISOString() });
    await queueCampaignSend(createAdminClient(), before.id, Date.now());
    drainSoon();
  });
}

export async function cancelCampaign(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    await move(formData, "crm.campaigns.write", "cancelled");
  });
}

export async function addCampaignNote(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ campaignId: z.guid(), body: z.string().trim().min(1).max(4000) }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("crm_notes").insert({ campaign_id: p.campaignId, author_staff_id: ctx.userId, body: p.body });
    if (error) throw new Error(error.message);
    revalidatePath(`/staff/crm/campaigns/${p.campaignId}`);
  });
}
