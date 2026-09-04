import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

/**
 * Every email the system has produced, whichever provider sent it. On a
 * developer machine with EMAIL_PROVIDER=dev this is the parent's inbox: open
 * a message, click its link, and walk the journey.
 */
export default async function OutboxPage() {
  const { supabase } = await requireStaff("admin");
  const { data: messages } = await supabase
    .from("email_messages")
    .select("id, to_email, subject, template_key, provider, status, created_at, applications(reference)")
    .order("created_at", { ascending: false })
    .limit(200);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const provider = process.env.EMAIL_PROVIDER ?? "dev";

  return (
    <>
      <PageTitle title="Email outbox" description={`Provider: ${provider}${provider === "dev" ? " — nothing is actually sent; open a message to follow its link." : ""}`} />
      {messages && messages.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {messages.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{formatDateTime(m.created_at)}</span>
              <Link href={`/staff/admin/dev-outbox/${m.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{m.subject}</Link>
              <span className="hidden text-xs text-muted-foreground sm:inline">{m.to_email} · {one(m.applications)?.reference}</span>
              <Badge variant={m.status === "failed" || m.status === "bounced" ? "destructive" : m.status === "queued" ? "muted" : "success"}>{m.status}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No emails yet.</EmptyState>
      )}
    </>
  );
}
