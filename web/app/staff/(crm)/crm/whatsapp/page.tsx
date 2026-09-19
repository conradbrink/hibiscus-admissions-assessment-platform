import Link from "next/link";
import { Pill, queryBuilder } from "@/components/crm/bits";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { listConversations, loadConversation } from "@/lib/crm/inbox";
import { formatDateTime } from "@/lib/format-date";
import { deliveryProof } from "@/lib/messaging/delivery";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { activeTemplates } from "@/lib/messaging/send";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import { sendWhatsAppToContact } from "../contacts/actions";
import { markConversationRead } from "./actions";

/**
 * The WhatsApp inbox: conversations on the left, the one chosen on the
 * right, with every message's delivery proof and the trail under it. A
 * reply is sent as an approved template — there is no free-text box, by
 * the rule in AGENTS.md — and the parent is answered by phone or email
 * where a template will not do.
 */
export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ contact?: string; q?: string; unread?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.write");
  const [conversations, provider, settings, { data: templates }] = await Promise.all([
    listConversations(supabase, { q: sp.q, unreadOnly: sp.unread === "1" }),
    getMessagingProvider(),
    getSettings(supabase),
    supabase.from("message_templates").select("*").eq("audience", "family"),
  ]);
  const current = sp.contact ? await loadConversation(supabase, sp.contact) : null;
  const sendable = activeTemplates(templates ?? [], provider.templateIdField);
  const qs = queryBuilder(sp);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const fam = current ? one(current.contact.families) : null;
  const unreadHere = current ? current.messages.filter((m) => m.direction === "in" && !m.crm_read_at).length : 0;

  return (
    <>
      <PageTitle title="WhatsApp" description={`Provider: ${provider.name}${settings.whatsappEnabled ? "" : " · sending is switched off (Settings → WhatsApp)"}. Every message is an approved template; a reply from a parent lands here and on the family.`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="surface">
          <div className="space-y-2 px-4 pt-4 pb-2">
            <form method="get" className="flex gap-2">
              {sp.unread ? <input type="hidden" name="unread" value={sp.unread} /> : null}
              <Input name="q" placeholder="Search conversations" defaultValue={sp.q ?? ""} className="h-9 md:h-9" />
            </form>
            <div className="flex gap-1.5"><Pill href={qs({ unread: undefined })} active={!sp.unread}>All</Pill><Pill href={qs({ unread: "1" })} active={sp.unread === "1"}>Unread</Pill></div>
          </div>
          {conversations.length ? (
            <ul className="max-h-[70vh] divide-y divide-border/70 overflow-y-auto">
              {conversations.map((c) => (
                <li key={c.contactId}>
                  <Link href={qs({ contact: c.contactId })} className={`block px-4 py-2.5 text-sm hover:bg-muted/50 ${sp.contact === c.contactId ? "bg-accent/40" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{c.contact ? `${c.contact.first_name} ${c.contact.last_name}` : "Unknown number"}</span>
                      {c.unread ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{c.unread}</span> : null}
                      <span className="text-[11px] text-muted-foreground">{formatDateTime(c.last.created_at)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{c.family ? `${c.family.display_name ?? c.family.family_code} · ` : ""}{c.last.direction === "in" ? "↩ " : ""}{c.last.rendered_text || c.last.template_key || c.last.status}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="px-4 pb-4"><EmptyState>No conversations yet.</EmptyState></div>}
        </section>

        <section className="surface">
          {current ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/crm/contacts/${current.contact.id}`} className="font-semibold hover:underline">{current.contact.first_name} {current.contact.last_name}</Link>
                  <p className="text-xs text-muted-foreground">{current.contact.mobile ?? "no number"}{fam ? <> · <Link href={`/staff/crm/families/${fam.id}`} className="hover:underline">{fam.display_name ?? fam.family_code} family</Link></> : null} · {current.contact.whatsapp_opt_in ? "updates on" : "updates off"}{current.contact.marketing_whatsapp_consent ? " · marketing on" : ""}</p>
                </div>
                {unreadHere ? <ActionForm action={markConversationRead} label={`Mark ${unreadHere} read`} size="xs" variant="outline"><input type="hidden" name="contactId" value={current.contact.id} /></ActionForm> : null}
              </div>
              <ul className="max-h-[55vh] space-y-2 overflow-y-auto px-5 py-4">
                {current.messages.map((m) => {
                  const proof = deliveryProof(m);
                  const trail = current.events.filter((e) => e.message_id === m.id);
                  return (
                    <li key={m.id} className={`max-w-xl rounded-xl px-3 py-2 text-sm ${m.direction === "in" ? "bg-muted" : "ml-auto bg-success/10"}`}>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDateTime(m.sent_at ?? m.received_at ?? m.created_at)}</span>
                        <span>{m.direction === "in" ? "from the parent" : m.template_key ?? "sent"}</span>
                        <Badge variant={m.status === "failed" ? "destructive" : m.status === "skipped" || m.status === "queued" ? "muted" : "success"} className="ml-auto">{m.status}</Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{m.rendered_text || (m.status === "skipped" ? `Not sent: ${m.error}` : m.error)}</p>
                      <p className={`mt-1 text-xs ${proof.confirmed ? "text-success" : m.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{proof.confirmed ? "✓ " : ""}{proof.summary}{m.trigger_source === "manual" ? " · sent by hand" : m.trigger_source === "campaign" ? " · campaign" : ""}{m.direction === "in" && m.crm_read_at ? " · read by staff" : ""}</p>
                      {trail.length ? (
                        <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">Delivery history ({trail.length})</summary>
                          <ul className="mt-1 border-l border-border pl-2">{trail.map((e) => <li key={e.id} className={e.applied ? "" : "text-muted-foreground"}><span className="font-mono">{e.status}</span> · {formatDateTime(e.occurred_at)}{e.detail ? <span className="block text-muted-foreground">{e.detail}</span> : null}</li>)}</ul>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {canWrite ? (
                <div className="border-t border-border/70 px-5 py-3">
                  {!current.contact.whatsapp_opt_in ? (
                    <p className="text-xs text-muted-foreground">This parent has WhatsApp updates switched off. Answer by phone or email.</p>
                  ) : sendable.length ? (
                    <ActionForm action={sendWhatsAppToContact} label="Send template" size="sm" variant="outline" className="flex flex-wrap items-center gap-2 space-y-0">
                      <input type="hidden" name="contactId" value={current.contact.id} />
                      <NativeSelect name="templateKey" defaultValue={sendable[0].key} className="w-64" aria-label="Template">{sendable.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</NativeSelect>
                      <span className="text-xs text-muted-foreground">Only approved templates can be sent. Anything else, say by phone or email.</span>
                    </ActionForm>
                  ) : <p className="text-xs text-muted-foreground">No active family template has a {provider.name} template id. Settings → WhatsApp templates.</p>}
                </div>
              ) : null}
            </>
          ) : <div className="p-5"><EmptyState>Choose a conversation.</EmptyState></div>}
        </section>
      </div>
    </>
  );
}
