"use client";

import { useState } from "react";
import { ActionForm } from "@/components/staff/action-form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CAMPAIGN_CATEGORY_LABELS, SENSITIVE_CATEGORIES } from "@/lib/crm/labels";
import { CAMPAIGN_VARIABLE_HINTS, CAMPAIGN_VARIABLES } from "@/lib/crm/campaigns/variables";
import type { CampaignCategory, CampaignChannel, CampaignRow } from "@/lib/supabase/types";
import { createCampaign, updateCampaign } from "@/app/staff/(crm)/crm/campaigns/actions";

type Template = { key: string; name: string; body_preview: string; parameters: string[] };

/**
 * The campaign's three authoring steps on one form: kind, audience,
 * message. The email is written in plain text with {{variables}}; the
 * WhatsApp half is an approved template chosen from the list the live
 * provider can send. A sensitive category says so as it is chosen.
 */
export function CampaignForm({
  campaign,
  segments,
  campuses,
  templates,
  events,
  providerName,
  preset,
}: {
  campaign?: CampaignRow;
  segments: Array<{ id: string; name: string; match_count: number | null; campus_id: string | null }>;
  campuses: Array<{ id: string; name: string }>;
  templates: Template[];
  events: Array<{ id: string; name: string }>;
  providerName: string;
  preset?: { segmentId?: string; eventId?: string };
}) {
  const [channel, setChannel] = useState<CampaignChannel>(campaign?.channel ?? "email");
  const [category, setCategory] = useState<CampaignCategory>(campaign?.category ?? (preset?.eventId ? "event" : "general"));
  const [templateKey, setTemplateKey] = useState(campaign?.message_template_key ?? templates[0]?.key ?? "");
  const template = templates.find((t) => t.key === templateKey);
  const wantsEmail = channel !== "whatsapp";
  const wantsWhatsApp = channel !== "email";

  return (
    <ActionForm action={campaign ? updateCampaign : createCampaign} label={campaign ? "Save changes" : "Save draft"} size="lg" resetOnSubmit={false} className="max-w-3xl space-y-4">
      {campaign ? <input type="hidden" name="campaignId" value={campaign.id} /> : null}
      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold">Step 1 · What kind of campaign</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Name (staff see this)</span><Input name="name" defaultValue={campaign?.name ?? ""} required maxLength={160} /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Channel</span>
            <NativeSelect name="channel" value={channel} onChange={(e) => setChannel(e.target.value as CampaignChannel)}>
              <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="both">WhatsApp and email</option>
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Category</span>
            <NativeSelect name="category" value={category} onChange={(e) => setCategory(e.target.value as CampaignCategory)}>
              {Object.entries(CAMPAIGN_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Description (optional)</span><Input name="description" defaultValue={campaign?.description ?? ""} maxLength={1000} /></label>
        </div>
        {SENSITIVE_CATEGORIES.has(category) ? (
          <p className="rounded-xl bg-warning/15 px-3 py-2 text-xs">A fee notice, a policy announcement or a group-wide announcement is a service message: it goes to every family in the audience whatever their marketing consent, and it needs approval from somebody who may approve sensitive communications.</p>
        ) : (
          <p className="text-xs text-muted-foreground">A marketing message goes only to contacts who consented to marketing on that channel. Every marketing email carries an unsubscribe link.</p>
        )}
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold">Step 2 · Who it goes to</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Segment</span>
            <NativeSelect name="segmentId" defaultValue={campaign?.segment_id ?? preset?.segmentId ?? ""} required>
              <option value="" disabled>Choose a segment</option>
              {segments.map((s) => <option key={s.id} value={s.id}>{s.name}{s.match_count !== null ? ` (${s.match_count})` : ""}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Narrow to a campus</span>
            <NativeSelect name="campusId" defaultValue={campaign?.campus_id ?? ""}><option value="">As the segment says</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">An event this invites them to (optional)</span>
            <NativeSelect name="eventId" defaultValue={campaign?.event_id ?? preset?.eventId ?? ""}><option value="">None</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</NativeSelect>
          </label>
        </div>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold">Step 3 · The message</h2>
        {wantsEmail ? (
          <div className="space-y-2">
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Email subject</span><Input name="emailSubject" defaultValue={campaign?.email_subject ?? ""} maxLength={200} required={wantsEmail} /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Email (plain English; a blank line starts a new paragraph)</span><Textarea name="emailBody" rows={10} defaultValue={campaign?.email_body_text ?? ""} maxLength={20000} required={wantsEmail} placeholder={"Dear {{parent_first_name}},\n\n…\n\nWarm regards,\nHibiscus International Schools"} /></label>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">What the message may include</summary>
              <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">{CAMPAIGN_VARIABLES.map((v) => <li key={v}><code>{`{{${v}}}`}</code> — {CAMPAIGN_VARIABLE_HINTS[v]}</li>)}</ul>
            </details>
          </div>
        ) : null}
        {wantsWhatsApp ? (
          <div className="space-y-2">
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">WhatsApp template (approved, with a {providerName} id)</span>
              {templates.length ? (
                <NativeSelect name="messageTemplateKey" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                  {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </NativeSelect>
              ) : <p className="text-sm text-destructive">No active family template has a {providerName} template id. Add one under Settings → WhatsApp templates.</p>}
            </label>
            {template ? <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm">{template.body_preview}<span className="block text-xs text-muted-foreground">Parameters: {template.parameters.join(", ") || "none"} — filled from the family.</span></p> : null}
          </div>
        ) : null}
      </section>
    </ActionForm>
  );
}
