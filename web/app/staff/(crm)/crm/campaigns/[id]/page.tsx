import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignBadge } from "@/components/crm/bits";
import { CampaignForm } from "@/components/crm/campaign-form";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildCampaignVariables, renderCampaign } from "@/lib/crm/campaigns/variables";
import { CAMPAIGN_CATEGORY_LABELS, CAMPAIGN_CHANNEL_LABELS, SENSITIVE_CATEGORIES } from "@/lib/crm/labels";
import { EXCLUSION_LABELS, isTransactional } from "@/lib/crm/recipients";
import { formatDateTime } from "@/lib/format-date";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { activeTemplates } from "@/lib/messaging/send";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { siteUrl } from "@/lib/tokens";
import { addCampaignNote, approveCampaign, backToDraft, cancelCampaign, pauseCampaign, prepare, rejectCampaign, resumeCampaign, scheduleCampaign, sendNow, submitForApproval } from "../actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type Stats = { total: number; pending: number; excluded: number; sent: number; skipped: number; failed: number; email: Record<string, number>; whatsapp: Record<string, number> };

/**
 * Steps 4 to 7 and the results: the preview rendered for one real family,
 * the recipient count with every exclusion and its reason, the approval,
 * schedule or send with a typed confirmation, and afterwards what became
 * of every message — from the two logs, not a counter.
 */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, permissions, userId } = await requireStaff("crm.read");
  const { data: c } = await supabase.from("campaigns").select("*, segments(id, name, match_count), campuses(name), crm_events(id, name, starts_at, location), creator:staff_profiles!campaigns_created_by_fkey(full_name), approver:staff_profiles!campaigns_approved_by_fkey(full_name)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const canWrite = can(permissions, "crm.campaigns.write");
  const sensitive = SENSITIVE_CATEGORIES.has(c.category);
  const canApprove = can(permissions, "crm.campaigns.approve") && (!sensitive || can(permissions, "crm.campaigns.approve_sensitive"));

  const [{ data: statsRaw }, { data: excluded }, { data: sampleRecipient }, { data: notes }, { data: segments }, { data: campuses }, { data: templates }, provider, { data: events }, { data: recentSends }] = await Promise.all([
    supabase.rpc("crm_campaign_stats", { p_campaign_id: id }),
    supabase.from("campaign_recipients").select("id, channel, exclusion_reason, status, error, contacts(first_name, last_name), families!campaign_recipients_family_id_fkey(id, display_name, family_code)").eq("campaign_id", id).in("status", ["excluded", "failed", "skipped"]).order("status").limit(200),
    supabase.from("campaign_recipients").select("family_id, contact_id").eq("campaign_id", id).eq("channel", "email").in("status", ["pending", "sent"]).limit(1).maybeSingle(),
    supabase.from("crm_notes").select("*, staff_profiles(full_name)").eq("campaign_id", id).order("created_at", { ascending: false }),
    supabase.from("segments").select("id, name, match_count, campus_id").eq("is_active", true).order("name"),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("message_templates").select("*").eq("audience", "family"),
    getMessagingProvider(),
    supabase.from("crm_events").select("id, name").eq("is_cancelled", false).gte("starts_at", new Date().toISOString()).order("starts_at"),
    supabase.from("campaign_recipients").select("id, channel, status, sent_at, contacts(first_name, last_name), families!campaign_recipients_family_id_fkey(id, display_name, family_code)").eq("campaign_id", id).eq("status", "sent").order("sent_at", { ascending: false }).limit(20),
  ]);
  const stats = (statsRaw ?? null) as Stats | null;

  // The preview: the message as one real family in the list would read it.
  let preview: { subject: string; bodyHtml: string; text: string; who: string } | null = null;
  if (c.email_subject && c.email_body_html && c.email_body_text) {
    let ctxFamily: { contact: { first_name: string; last_name: string; unsubscribe_token: string }; family: { display_name: string | null; family_code: string }; campus: { name: string; phone: string | null } | null; students: Array<{ preferred_name: string | null; legal_first_name: string; date_of_birth: string; status: string }> } | null = null;
    if (sampleRecipient) {
      const [{ data: contact }, { data: family }, { data: students }] = await Promise.all([
        supabase.from("contacts").select("first_name, last_name, unsubscribe_token").eq("id", sampleRecipient.contact_id).maybeSingle(),
        supabase.from("families").select("display_name, family_code, campuses!families_campus_id_fkey(name, phone)").eq("id", sampleRecipient.family_id).maybeSingle(),
        supabase.from("students").select("preferred_name, legal_first_name, date_of_birth, status").eq("family_id", sampleRecipient.family_id),
      ]);
      if (contact && family) ctxFamily = { contact, family, campus: one(family.campuses) ? { name: one(family.campuses)!.name, phone: one(family.campuses)!.phone } : null, students: students ?? [] };
    }
    const ev = one(c.crm_events);
    const vars = buildCampaignVariables({
      contact: ctxFamily?.contact ?? { first_name: "Parent", last_name: "Example", unsubscribe_token: "preview" },
      family: ctxFamily?.family ?? { display_name: "Example", family_code: "EXA0001" },
      campus: ctxFamily?.campus ?? { name: one(c.campuses)?.name ?? "Hibiscus", phone: null },
      students: ctxFamily?.students ?? [],
      event: ev ? { name: ev.name, when: formatDateTime(ev.starts_at), location: ev.location } : null,
      siteUrl: siteUrl(),
      familyLink: `${siteUrl()}/a/…`,
    });
    try {
      const rendered = renderCampaign({ email_subject: c.email_subject, email_body_html: c.email_body_html, email_body_text: c.email_body_text }, vars, { marketing: !isTransactional(c.category) });
      // Composed by lib/email/render.ts, which escapes every variable it substitutes.
      preview = { subject: rendered.subject, bodyHtml: rendered.html, text: rendered.text, who: ctxFamily ? `${ctxFamily.contact.first_name} ${ctxFamily.contact.last_name}` : "an example family" };
    } catch {
      preview = null;
    }
  }
  const exclusions = (c.exclusions ?? {}) as Record<string, number>;

  return (
    <>
      <PageTitle back={{ href: "/staff/crm/campaigns", label: "Campaigns" }} title={c.name} description={`${CAMPAIGN_CHANNEL_LABELS[c.channel]} · ${CAMPAIGN_CATEGORY_LABELS[c.category]} · to "${one(c.segments)?.name ?? "no audience"}"${one(c.campuses) ? ` at ${one(c.campuses)!.name}` : ""} · by ${one(c.creator)?.full_name ?? "—"}`}>
        <CampaignBadge status={c.status} />
        {canWrite && c.status === "draft" && !sp.edit ? <Link href={`/staff/crm/campaigns/${id}?edit=1`} className={buttonVariants({ variant: "outline", size: "lg" })}>Edit message</Link> : null}
      </PageTitle>

      {sp.edit && c.status === "draft" && canWrite ? (
        <div className="mb-5">
          <CampaignForm campaign={c} segments={segments ?? []} campuses={campuses ?? []} templates={activeTemplates(templates ?? [], provider.templateIdField).map((t) => ({ key: t.key, name: t.name, body_preview: t.body_preview, parameters: t.parameters }))} events={events ?? []} providerName={provider.name} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Step 4 · Preview</h2>
            {preview ? (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">As {preview.who} would read it.</p>
                <p className="mt-2 font-medium">{preview.subject}</p>
                <div className="prose prose-sm mt-2 rounded-xl border border-border/70 bg-background p-4" dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} />
              </div>
            ) : c.channel === "whatsapp" ? (
              <p className="mt-1 text-sm text-muted-foreground">WhatsApp only: the template &ldquo;{c.message_template_key}&rdquo; is sent with each family&rsquo;s own names.</p>
            ) : <p className="mt-1 text-sm text-muted-foreground">Prepare the list to preview the email for a real family.</p>}
            {c.message_template_key ? <p className="mt-3 text-xs text-muted-foreground">WhatsApp: template &ldquo;{c.message_template_key}&rdquo; through {provider.name}.</p> : null}
          </section>

          <section className="surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Step 5 · Recipients</h2>
              {canWrite && (c.status === "draft" || c.status === "pending_approval" || c.status === "approved") ? <ActionForm action={prepare} label={c.prepared_at ? "Prepare again" : "Prepare the list"} size="sm" variant="outline"><input type="hidden" name="campaignId" value={id} /></ActionForm> : null}
            </div>
            {c.prepared_at ? (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[["Families", c.recipients_total], ["Email", c.recipients_email], ["WhatsApp", c.recipients_whatsapp], ["Excluded", c.excluded_count]].map(([l, v]) => (
                    <div key={String(l)} className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{l}</dt><dd className="text-2xl font-semibold tabular-nums">{v ?? 0}</dd></div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Prepared {formatDateTime(c.prepared_at)}. Segment count at the time: {one(c.segments)?.match_count ?? "—"} families.</p>
                {Object.keys(exclusions).length ? (
                  <ul className="mt-2 text-sm">{Object.entries(exclusions).sort((a, b) => b[1] - a[1]).map(([reason, n]) => <li key={reason}>{EXCLUSION_LABELS[reason as keyof typeof EXCLUSION_LABELS] ?? reason}: <span className="font-semibold tabular-nums">{n}</span></li>)}</ul>
                ) : <p className="mt-2 text-sm text-success">Nobody excluded.</p>}
                {(c.recipients_email ?? 0) + (c.recipients_whatsapp ?? 0) === 0 ? <p className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">Nobody would receive this campaign. Check the segment and the families&rsquo; consent.</p> : null}
              </>
            ) : <p className="mt-1 text-sm text-muted-foreground">Not prepared yet. Preparing freezes the list and shows who is in, who is out and why.</p>}
          </section>

          {stats && (c.status === "sending" || c.status === "sent" || c.status === "paused") ? (
            <section className="surface p-5">
              <h2 className="text-sm font-semibold">Results</h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[["Sent", stats.sent], ["Pending", stats.pending], ["Skipped", stats.skipped], ["Failed", stats.failed]].map(([l, v]) => (
                  <div key={String(l)} className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{l}</dt><dd className="text-2xl font-semibold tabular-nums">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
                {c.channel !== "whatsapp" ? <div><p className="font-medium">Email</p><p className="text-xs text-muted-foreground">sent {stats.email.sent} · delivered {stats.email.delivered} · opened {stats.email.opened} · clicked {stats.email.clicked} · bounced {stats.email.bounced} · failed {stats.email.failed}</p></div> : null}
                {c.channel !== "email" ? <div><p className="font-medium">WhatsApp</p><p className="text-xs text-muted-foreground">sent {stats.whatsapp.sent} · delivered {stats.whatsapp.delivered} · read {stats.whatsapp.read} · failed {stats.whatsapp.failed} · replies {stats.whatsapp.replies}</p></div> : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Delivery, opens, clicks and reads are what the providers reported through their webhooks; a figure the provider does not report stays at zero rather than being guessed.</p>
              {recentSends?.length ? <ul className="mt-2 divide-y divide-border/70 text-xs">{recentSends.map((r) => <li key={r.id} className="py-1"><Link href={`/staff/crm/families/${one(r.families)?.id}`} className="hover:underline">{one(r.families)?.display_name ?? one(r.families)?.family_code}</Link> · {one(r.contacts)?.first_name} {one(r.contacts)?.last_name} · {r.channel} · {r.sent_at ? formatDateTime(r.sent_at) : ""}</li>)}</ul> : null}
            </section>
          ) : null}

          {excluded?.length ? (
            <section className="surface">
              <div className="px-5 pt-4 pb-2"><h2 className="text-sm font-semibold">Left out, and why</h2></div>
              <ul className="max-h-80 divide-y divide-border/70 overflow-y-auto text-sm">
                {excluded.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-1.5">
                    <Link href={`/staff/crm/families/${one(r.families)?.id}`} className="hover:underline">{one(r.families)?.display_name ?? one(r.families)?.family_code}</Link>
                    <span className="text-xs text-muted-foreground">{one(r.contacts)?.first_name} {one(r.contacts)?.last_name} · {r.channel}</span>
                    <Badge variant={r.status === "failed" ? "destructive" : "muted"} className="ml-auto">{r.status === "excluded" ? EXCLUSION_LABELS[r.exclusion_reason as keyof typeof EXCLUSION_LABELS] ?? r.exclusion_reason : r.error ?? r.exclusion_reason ?? r.status}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Step 6 · Approval</h2>
            {c.status === "draft" && canWrite ? (
              <ActionForm action={submitForApproval} label="Submit for approval" size="sm" className="mt-2"><input type="hidden" name="campaignId" value={id} /></ActionForm>
            ) : null}
            {c.status === "pending_approval" ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">Submitted {c.submitted_at ? formatDateTime(c.submitted_at) : ""}.{sensitive ? " Needs a senior approval." : ""}</p>
                {canApprove && c.created_by !== userId ? (
                  <>
                    <ActionForm action={approveCampaign} label="Approve" size="sm" variant="success" className="mt-2"><input type="hidden" name="campaignId" value={id} /><Input name="note" placeholder="A note (optional)" /></ActionForm>
                    <ActionForm action={rejectCampaign} label="Send back" size="sm" variant="destructive" className="mt-2"><input type="hidden" name="campaignId" value={id} /><Input name="reason" placeholder="Why" required /></ActionForm>
                  </>
                ) : canApprove ? <p className="mt-2 text-xs text-muted-foreground">You wrote this one; somebody else has to approve it.</p> : <p className="mt-2 text-xs text-muted-foreground">Waiting for an approver.</p>}
                {canWrite ? <ActionForm action={backToDraft} label="Back to draft" size="xs" variant="ghost" className="mt-2"><input type="hidden" name="campaignId" value={id} /></ActionForm> : null}
              </>
            ) : null}
            {c.approved_at ? <p className="mt-1 text-xs text-success">Approved by {one(c.approver)?.full_name ?? "—"} on {formatDateTime(c.approved_at)}.{c.approval_note ? ` "${c.approval_note}"` : ""}</p> : null}
            {c.rejection_reason && c.status === "draft" ? <p className="mt-1 text-xs text-destructive">Sent back: {c.rejection_reason}</p> : null}
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Step 7 · Send</h2>
            {c.status === "approved" && canWrite ? (
              <>
                <ActionForm action={scheduleCampaign} label="Schedule" size="sm" variant="outline" className="mt-2"><input type="hidden" name="campaignId" value={id} /><Input type="datetime-local" name="scheduledAt" required /></ActionForm>
                <ActionForm action={sendNow} label="Send now" size="sm" className="mt-3" confirm={`Send "${c.name}" to ${c.recipients_total ?? 0} families now?`}>
                  <input type="hidden" name="campaignId" value={id} />
                  <p className="text-xs text-muted-foreground">Recipients: {c.recipients_total ?? 0} families · {c.recipients_email ?? 0} email · {c.recipients_whatsapp ?? 0} WhatsApp · {c.excluded_count ?? 0} excluded.</p>
                  <Input name="confirm" placeholder="Type SEND to confirm" required />
                </ActionForm>
              </>
            ) : null}
            {c.status === "scheduled" ? <p className="mt-1 text-sm">Sends at {c.scheduled_at ? formatDateTime(c.scheduled_at) : "—"}.</p> : null}
            {c.status === "sending" ? <p className="mt-1 text-sm">Sending, in batches, from the job drain.</p> : null}
            {c.status === "sent" ? <p className="mt-1 text-sm">Sent. Finished {c.finished_at ? formatDateTime(c.finished_at) : ""}.</p> : null}
            {canWrite && (c.status === "scheduled" || c.status === "sending") ? <ActionForm action={pauseCampaign} label="Pause" size="xs" variant="outline" className="mt-2"><input type="hidden" name="campaignId" value={id} /></ActionForm> : null}
            {canWrite && c.status === "paused" ? <ActionForm action={resumeCampaign} label="Resume" size="xs" variant="outline" className="mt-2"><input type="hidden" name="campaignId" value={id} /></ActionForm> : null}
            {canWrite && c.status !== "sent" && c.status !== "cancelled" ? <ActionForm action={cancelCampaign} label="Cancel campaign" size="xs" variant="ghost" className="mt-2" confirm="Cancel this campaign?"><input type="hidden" name="campaignId" value={id} /></ActionForm> : null}
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Notes</h2>
            {notes?.length ? <ul className="mt-2 space-y-2 text-sm">{notes.map((n) => <li key={n.id} className="rounded-xl bg-muted/60 px-3 py-2"><p className="whitespace-pre-line">{n.body}</p><p className="text-[11px] text-muted-foreground">{one(n.staff_profiles)?.full_name} · {formatDateTime(n.created_at)}</p></li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">None yet.</p>}
            {can(permissions, "crm.write") ? <ActionForm action={addCampaignNote} label="Add note" size="xs" variant="outline" className="mt-2"><input type="hidden" name="campaignId" value={id} /><Textarea name="body" rows={2} required maxLength={4000} /></ActionForm> : null}
          </section>
          {!c.prepared_at && !stats ? <EmptyState>Prepare the list to see who this reaches.</EmptyState> : null}
        </div>
      </div>
    </>
  );
}
