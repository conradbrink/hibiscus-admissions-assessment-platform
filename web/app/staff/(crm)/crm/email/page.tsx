import Link from "next/link";
import { Pagination, Pill, queryBuilder } from "@/components/crm/bits";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format-date";
import { getEmailProvider } from "@/lib/email/provider";
import { requireStaff } from "@/lib/staff/session";

const PAGE = 50;

/**
 * Every email the school has sent to a family, with what became of it.
 * The rows are `email_messages`, read through the caller's client; a
 * campaign's emails are the same rows with the campaign's key.
 */
export default async function EmailPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("crm.read");
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  let q = supabase
    .from("email_messages")
    .select("id, subject, to_email, template_key, status, sent_at, opened_at, clicked_at, created_at, family_id, application_id, contact_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.q?.trim()) {
    const term = sp.q.trim().replace(/[%,()]/g, " ");
    q = q.or(`subject.ilike.%${term}%,to_email.ilike.%${term}%,template_key.ilike.%${term}%`);
  }
  if (sp.status === "opened") q = q.in("status", ["opened", "clicked"]);
  else if (sp.status === "bounced") q = q.in("status", ["bounced", "failed"]);
  else if (sp.status === "campaign") q = q.like("template_key", "campaign:%");
  const [{ data: rows, count }, provider] = await Promise.all([q, getEmailProvider()]);
  const qs = queryBuilder(sp);
  const tone = (s: string) => (s === "bounced" || s === "failed" ? "destructive" : s === "queued" ? "muted" : s === "opened" || s === "clicked" ? "info" : "success");

  return (
    <>
      <PageTitle title="Email" description={`Provider: ${provider.name}${provider.name === "dev" ? " — nothing is actually sent; open a message to read it." : ""}. Every email to a family, and whether it was delivered, opened or clicked where the provider reports it.`} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Pill href={qs({ status: undefined, page: undefined })} active={!sp.status}>All</Pill>
        <Pill href={qs({ status: "campaign", page: undefined })} active={sp.status === "campaign"}>Campaigns</Pill>
        <Pill href={qs({ status: "opened", page: undefined })} active={sp.status === "opened"}>Opened</Pill>
        <Pill href={qs({ status: "bounced", page: undefined })} active={sp.status === "bounced"}>Bounced or failed</Pill>
      </div>
      <form method="get" className="mb-4 flex gap-2">{sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}<Input name="q" placeholder="Subject, address or template" defaultValue={sp.q ?? ""} className="w-72" /></form>
      {rows?.length ? (
        <ul className="divide-y divide-border surface text-sm">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{formatDateTime(m.sent_at ?? m.created_at)}</span>
              <Link href={`/staff/admin/dev-outbox/${m.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{m.subject}</Link>
              <span className="hidden text-xs text-muted-foreground sm:inline">{m.to_email}{m.template_key ? ` · ${m.template_key}` : ""}</span>
              {m.family_id ? <Link href={`/staff/crm/families/${m.family_id}`} className="text-xs underline">family</Link> : m.application_id ? <Link href={`/staff/applications/${m.application_id}`} className="text-xs underline">applicant</Link> : null}
              <Badge variant={tone(m.status)}>{m.status}</Badge>
            </li>
          ))}
        </ul>
      ) : <EmptyState>No emails match.</EmptyState>}
      <Pagination page={page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} qs={qs} />
    </>
  );
}
