import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { simulateReply } from "./actions";

/**
 * Every email and WhatsApp message the system has produced, whichever
 * provider sent it. On a developer machine with the dev providers this is
 * the parent's inbox and phone: open a message, click its link, and walk
 * the journey; type a reply and watch it become a task.
 */
export default async function OutboxPage() {
  const { supabase } = await requireStaff("admin");
  const [{ data: messages }, { data: whatsapp }] = await Promise.all([
    supabase
      .from("email_messages")
      .select("id, to_email, subject, template_key, provider, status, created_at, applications(reference)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("messages")
      .select("id, direction, to_normalised, from_normalised, template_key, provider, status, rendered_text, error, created_at, application_id, applications(reference)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const provider = process.env.EMAIL_PROVIDER ?? "dev";
  const messaging = process.env.MESSAGING_PROVIDER ?? "dev";
  const canSimulate = process.env.VERCEL_ENV !== "production";

  return (
    <>
      <PageTitle title="Outbox" description={`Email provider: ${provider}${provider === "dev" ? " — nothing is actually sent; open a message to follow its link." : ""} · Messaging provider: ${messaging}.`} />
      <h2 className="mb-2 text-sm font-semibold">Emails</h2>
      {messages && messages.length > 0 ? (
        <ul className="mb-6 divide-y divide-border rounded-xl border border-border bg-card text-sm">
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
        <div className="mb-6"><EmptyState>No emails yet.</EmptyState></div>
      )}

      <h2 className="mb-2 text-sm font-semibold">WhatsApp</h2>
      {whatsapp && whatsapp.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {whatsapp.map((m) => (
            <li key={m.id} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{formatDateTime(m.created_at)}</span>
                <span className="text-xs font-medium">{m.direction === "out" ? `→ ${m.to_normalised ?? "?"}` : `← ${m.from_normalised ?? "?"}`}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{m.template_key ?? "reply"} · <Link href={`/staff/applications/${m.application_id}`} className="underline">{one(m.applications)?.reference}</Link></span>
                <Badge variant={m.status === "failed" ? "destructive" : m.status === "skipped" || m.status === "queued" ? "muted" : "success"}>{m.status}</Badge>
              </div>
              <p className="mt-1 pl-35 text-xs whitespace-pre-wrap">{m.rendered_text || (m.error ? <span className="text-muted-foreground">{m.error}</span> : null)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No WhatsApp messages yet.</EmptyState>
      )}

      {canSimulate ? (
        <section className="mt-6 rounded-xl border border-dashed border-border p-4 text-sm">
          <h3 className="text-sm font-semibold">Simulate a parent&rsquo;s reply</h3>
          <p className="mb-2 text-xs text-muted-foreground">Development only. Runs the same path the webhook does: STOP opts out, START opts in, anything else opens a task for the campus team.</p>
          <ActionForm action={simulateReply} label="Deliver reply" variant="outline" size="sm">
            <div className="flex flex-wrap gap-2">
              <Input name="from" placeholder="71 234 567" className="w-40" required />
              <Input name="text" placeholder="What time should we arrive?" className="w-80" required />
            </div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
