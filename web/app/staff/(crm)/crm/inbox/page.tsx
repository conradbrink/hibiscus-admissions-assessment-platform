import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { listConversations } from "@/lib/crm/inbox";
import { formatDateTime } from "@/lib/format-date";
import { getEmailProvider } from "@/lib/email/provider";
import { requireStaff } from "@/lib/staff/session";

/**
 * Everything waiting on a person, across channels: WhatsApp replies nobody
 * has opened, and the email that bounced or failed. Email replies do not
 * arrive here — the email provider delivers them to the school's mailbox,
 * and this page says so rather than showing an empty tab that looks like
 * silence.
 */
export default async function InboxPage() {
  const { supabase } = await requireStaff("crm.read");
  const [unread, { data: bounced }, provider, { count: recentTasks }] = await Promise.all([
    listConversations(supabase, { unreadOnly: true, limit: 50 }),
    supabase.from("email_messages").select("id, subject, to_email, status, error, created_at, family_id, contact_id").in("status", ["bounced", "failed"]).order("created_at", { ascending: false }).limit(30),
    getEmailProvider(),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open").eq("type", "parent_replied"),
  ]);
  return (
    <>
      <PageTitle title="Inbox" description="What is waiting on a person. WhatsApp replies land here; email replies go to the school's own mailbox." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface">
          <div className="flex items-center justify-between px-5 pt-4 pb-2"><h2 className="font-semibold">WhatsApp replies to read</h2><Link href="/staff/crm/whatsapp?unread=1" className="text-xs font-medium text-primary hover:underline">Open WhatsApp</Link></div>
          {unread.length ? (
            <ul className="divide-y divide-border/70">
              {unread.map((c) => (
                <li key={c.contactId}>
                  <Link href={`/staff/crm/whatsapp?contact=${c.contactId}`} className="block px-5 py-2.5 text-sm hover:bg-muted/50">
                    <span className="font-medium">{c.contact ? `${c.contact.first_name} ${c.contact.last_name}` : "Unknown"}</span>
                    <span className="ml-2 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{c.unread}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.family ? `${c.family.display_name ?? c.family.family_code} · ` : ""}{c.last.rendered_text}</span>
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(c.last.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="px-5 pb-5"><EmptyState>Every reply has been read.{recentTasks ? ` ${recentTasks} reply task${recentTasks === 1 ? "" : "s"} still open under Tasks.` : ""}</EmptyState></div>}
        </section>
        <section className="surface">
          <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">Email that did not arrive</h2><p className="text-xs text-muted-foreground">Provider: {provider.name}. Bounces and failures, newest first.</p></div>
          {bounced?.length ? (
            <ul className="divide-y divide-border/70">
              {bounced.map((m) => (
                <li key={m.id} className="px-5 py-2.5 text-sm">
                  <Link href={`/staff/admin/dev-outbox/${m.id}`} className="font-medium hover:underline">{m.subject}</Link>
                  <Badge variant="destructive" className="ml-2">{m.status}</Badge>
                  <span className="block text-xs text-muted-foreground">{m.to_email} · {formatDateTime(m.created_at)}{m.error ? ` · ${m.error}` : ""}{m.family_id ? <> · <Link href={`/staff/crm/families/${m.family_id}`} className="underline">family</Link></> : null}</span>
                </li>
              ))}
            </ul>
          ) : <div className="px-5 pb-5"><EmptyState>Nothing bounced or failed.</EmptyState></div>}
        </section>
      </div>
    </>
  );
}
