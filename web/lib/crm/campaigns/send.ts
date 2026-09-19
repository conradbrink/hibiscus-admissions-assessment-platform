import "server-only";
import { buildCampaignVariables, renderCampaign, type CampaignFamilyContext } from "@/lib/crm/campaigns/variables";
import { notifyStaff } from "@/lib/crm/notifications";
import { isTransactional } from "@/lib/crm/recipients";
import { wrapHtml } from "@/lib/email/layout";
import { getEmailProvider } from "@/lib/email/provider";
import { formatDateLong, formatTime } from "@/lib/format-date";
import { sendFamilyMessage } from "@/lib/messaging/send";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { CampaignRow, JobRow } from "@/lib/supabase/types";
import { mintToken, siteUrl } from "@/lib/tokens";
import { enqueueJobs } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

/**
 * Sending a campaign, in batches, from the drain.
 *
 * One job per batch of recipients; the job re-queues itself while rows are
 * pending and marks the campaign `sent` when none are. Each recipient row
 * is claimed by moving it out of `pending` before anything is sent, so two
 * overlapping drains cannot send the same message twice, and the email or
 * message row it produced is written back onto it, so the campaign's
 * results are the two logs' truth rather than a counter.
 *
 * Email goes through the provider seam directly (the wording is the
 * campaign's own, not a template's); WhatsApp goes through
 * `sendFamilyMessage`, which enforces every rule that applies to any
 * family message — approved template, opt-in, the switch — on top of the
 * marketing consent the recipient list already checked.
 */

const BATCH = 50;

export async function queueCampaignSend(admin: AdminClient, campaignId: string, batch = 0): Promise<void> {
  await enqueueJobs(admin, [
    {
      type: "send_campaign",
      applicationId: null,
      idempotencyKey: `campaign:${campaignId}:batch:${batch}`,
      payload: { campaign_id: campaignId, batch },
    },
  ]);
}

export async function sendCampaignHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const payload = job.payload as { campaign_id?: string; batch?: number };
  if (!payload.campaign_id) return { outcome: "failed", error: "send_campaign job missing campaign_id", retryable: false };

  const { data: campaign, error } = await admin.from("campaigns").select("*").eq("id", payload.campaign_id).maybeSingle();
  if (error) return { outcome: "failed", error: error.message, retryable: true };
  if (!campaign) return { outcome: "skipped", reason: "campaign missing" };
  if (campaign.status === "paused" || campaign.status === "cancelled") return { outcome: "skipped", reason: `campaign is ${campaign.status}` };
  if (campaign.status !== "sending" && campaign.status !== "scheduled" && campaign.status !== "approved") {
    return { outcome: "skipped", reason: `campaign is ${campaign.status}` };
  }

  if (campaign.status !== "sending") {
    const started = await admin.from("campaigns").update({ status: "sending", started_at: campaign.started_at ?? new Date().toISOString() }).eq("id", campaign.id);
    if (started.error) return { outcome: "failed", error: started.error.message, retryable: true };
  }

  const result = await sendCampaignBatch(admin, { ...campaign, status: "sending" });

  if (result.remaining > 0) {
    await queueCampaignSend(admin, campaign.id, (payload.batch ?? 0) + 1);
    return { outcome: "done" };
  }

  const finished = await admin.from("campaigns").update({ status: "sent", finished_at: new Date().toISOString() }).eq("id", campaign.id);
  if (finished.error) return { outcome: "failed", error: finished.error.message, retryable: true };
  await notifyStaff(admin, campaign.created_by, {
    kind: "campaign_sent",
    title: `"${campaign.name}" has been sent`,
    body: `${result.sentSoFar} message${result.sentSoFar === 1 ? "" : "s"} went out.`,
    href: `/staff/crm/campaigns/${campaign.id}`,
  });
  return { outcome: "done" };
}

export type BatchResult = { sent: number; skipped: number; failed: number; remaining: number; sentSoFar: number };

export async function sendCampaignBatch(admin: AdminClient, campaign: CampaignRow): Promise<BatchResult> {
  const { data: pending, error } = await admin
    .from("campaign_recipients")
    .select("id, family_id, contact_id, channel")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .order("created_at")
    .limit(BATCH);
  if (error) throw new Error(error.message);

  const out: BatchResult = { sent: 0, skipped: 0, failed: 0, remaining: 0, sentSoFar: 0 };
  const settings = await getSettings(admin);
  const marketing = !isTransactional(campaign.category);
  const provider = await getEmailProvider();

  const event = campaign.event_id
    ? (await admin.from("crm_events").select("name, starts_at, location").eq("id", campaign.event_id).maybeSingle()).data
    : null;

  for (const r of pending ?? []) {
    // Claim the row. Zero rows updated means another drain got here first.
    const claimed = await admin.from("campaign_recipients").update({ status: "skipped", exclusion_reason: "claimed" }).eq("id", r.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed.data) continue;

    try {
      const ctx = await familyContext(admin, r.family_id, r.contact_id, event, campaign);
      if (!ctx) {
        await admin.from("campaign_recipients").update({ status: "skipped", exclusion_reason: "contact or family missing" }).eq("id", r.id);
        out.skipped += 1;
        continue;
      }
      // Consent is checked again at the moment of sending: a parent who
      // unsubscribed between approval and the send is not written to.
      if (marketing) {
        const reason = r.channel === "email"
          ? (!ctx.contact.marketing_email_consent || ctx.contact.unsubscribed_at ? "no consent to marketing email at send time" : null)
          : (!ctx.contact.marketing_whatsapp_consent ? "no consent to marketing WhatsApp at send time" : null);
        if (reason) {
          await admin.from("campaign_recipients").update({ status: "skipped", exclusion_reason: reason }).eq("id", r.id);
          out.skipped += 1;
          continue;
        }
      }

      if (r.channel === "email") {
        if (!campaign.email_subject || !campaign.email_body_html || !campaign.email_body_text) {
          await admin.from("campaign_recipients").update({ status: "skipped", exclusion_reason: "the campaign has no email" }).eq("id", r.id);
          out.skipped += 1;
          continue;
        }
        const vars = buildCampaignVariables(ctx.variables);
        const rendered = renderCampaign(
          { email_subject: campaign.email_subject, email_body_html: campaign.email_body_html, email_body_text: campaign.email_body_text },
          vars,
          { marketing }
        );
        const html = wrapHtml(rendered.html);
        const { data: message, error: mErr } = await admin
          .from("email_messages")
          .insert({
            family_id: r.family_id,
            contact_id: r.contact_id,
            template_key: `campaign:${campaign.id}`,
            to_email: ctx.contact.email,
            subject: rendered.subject,
            body_html: html,
            body_text: rendered.text,
            provider: provider.name,
            status: "queued",
          })
          .select("id")
          .single();
        if (mErr || !message) throw new Error(mErr?.message ?? "email insert failed");
        const sent = await provider.send({ to: ctx.contact.email, subject: rendered.subject, html, text: rendered.text, idempotencyKey: `campaign:${campaign.id}:${r.contact_id}` });
        if (!sent.ok) {
          await admin.from("email_messages").update({ status: "failed", error: sent.error }).eq("id", message.id);
          await admin.from("campaign_recipients").update({ status: "failed", error: sent.error, email_message_id: message.id }).eq("id", r.id);
          out.failed += 1;
          continue;
        }
        await admin.from("email_messages").update({ status: "sent", provider_message_id: sent.providerMessageId, sent_at: new Date().toISOString() }).eq("id", message.id);
        await admin.from("campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString(), email_message_id: message.id }).eq("id", r.id);
        out.sent += 1;
        continue;
      }

      // WhatsApp: the approved template, through the family sender.
      if (!campaign.message_template_key) {
        await admin.from("campaign_recipients").update({ status: "skipped", exclusion_reason: "the campaign has no WhatsApp template" }).eq("id", r.id);
        out.skipped += 1;
        continue;
      }
      if (!settings.whatsappEnabled) {
        await admin.from("campaign_recipients").update({ status: "skipped", exclusion_reason: "WhatsApp is switched off" }).eq("id", r.id);
        out.skipped += 1;
        continue;
      }
      const vars = buildCampaignVariables(ctx.variables);
      const mapping = (campaign.whatsapp_variables ?? {}) as Record<string, string>;
      const variables: Record<string, string | null> = {};
      for (const [param, source] of Object.entries(mapping)) {
        // A mapping value is either the name of a campaign variable or a
        // literal the author typed.
        variables[param] = source in vars ? (vars[source] ?? null) : source;
      }
      for (const [k, v] of Object.entries(vars)) if (!(k in variables)) variables[k] = v ?? null;
      const result = await sendFamilyMessage(admin, {
        familyId: r.family_id,
        contactId: r.contact_id,
        templateKey: campaign.message_template_key,
        idempotencyKey: `campaign:${campaign.id}:${r.contact_id}:whatsapp`,
        variables,
        link: ctx.link,
        trigger: "campaign",
      });
      if (result.status === "sent") {
        await admin.from("campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString(), message_id: result.messageId }).eq("id", r.id);
        out.sent += 1;
      } else if (result.status === "skipped") {
        await admin.from("campaign_recipients").update({ status: "skipped", exclusion_reason: result.reason }).eq("id", r.id);
        out.skipped += 1;
      } else {
        await admin.from("campaign_recipients").update({ status: "failed", error: result.error }).eq("id", r.id);
        out.failed += 1;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("campaign_recipients").update({ status: "failed", error: message }).eq("id", r.id);
      out.failed += 1;
    }
  }

  const { count } = await admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "pending");
  out.remaining = count ?? 0;
  const { count: sentSoFar } = await admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "sent");
  out.sentSoFar = sentSoFar ?? 0;
  return out;
}

type FamilyContext = {
  contact: { email: string; marketing_email_consent: boolean; marketing_whatsapp_consent: boolean; unsubscribed_at: string | null };
  variables: CampaignFamilyContext;
  link: "family" | "event" | null;
};

async function familyContext(
  admin: AdminClient,
  familyId: string,
  contactId: string,
  event: { name: string; starts_at: string; location: string | null } | null,
  campaign: CampaignRow
): Promise<FamilyContext | null> {
  const [{ data: contact }, { data: family }, { data: students }] = await Promise.all([
    admin.from("contacts").select("first_name, last_name, email, unsubscribe_token, marketing_email_consent, marketing_whatsapp_consent, unsubscribed_at").eq("id", contactId).maybeSingle(),
    admin.from("families").select("display_name, family_code, campus_id, campuses!families_campus_id_fkey(name, phone)").eq("id", familyId).maybeSingle(),
    admin.from("students").select("preferred_name, legal_first_name, date_of_birth, status").eq("family_id", familyId),
  ]);
  if (!contact || !family) return null;
  const campus = Array.isArray(family.campuses) ? (family.campuses[0] ?? null) : family.campuses;

  // A link only where the message asks for one: an event invitation lands
  // on the family's dates page, a general message on the hub. Minted at
  // send time, like every magic link, never stored in the campaign.
  const wants = campaign.email_body_html?.includes("family_link") || campaign.email_body_text?.includes("family_link") || campaign.event_id;
  let familyLink: string | null = null;
  let link: "family" | "event" | null = null;
  if (wants) {
    link = campaign.event_id ? "event" : "family";
    const settings = await getSettings(admin);
    const minted = await mintToken(admin, { familyId, purpose: link, ttlDays: settings.nextStepTokenDays, maxUses: null, reason: `campaign:${campaign.id}` });
    familyLink = minted.url;
  }

  return {
    contact,
    link,
    variables: {
      contact,
      family,
      campus: campus ? { name: campus.name, phone: campus.phone ?? null } : null,
      students: students ?? [],
      event: event ? { name: event.name, when: `${formatDateLong(event.starts_at)} at ${formatTime(event.starts_at)}`, location: event.location } : null,
      siteUrl: siteUrl(),
      familyLink,
    },
  };
}

/** Scheduled campaigns whose time has come: queue the first batch. Runs from the drain. */
export async function sweepScheduledCampaigns(admin: AdminClient, now: Date = new Date()): Promise<number> {
  const { data, error } = await admin.from("campaigns").select("id").eq("status", "scheduled").lte("scheduled_at", now.toISOString());
  if (error) throw new Error(error.message);
  for (const c of data ?? []) await queueCampaignSend(admin, c.id, 0);
  return (data ?? []).length;
}
