import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/staff/page-title";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

export default async function OutboxMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff("admin");
  const { data: m } = await supabase.from("email_messages").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();

  const links = [...m.body_html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]).filter((u) => u.startsWith("http"));

  return (
    <>
      <PageTitle title={m.subject} description={`To ${m.to_email} · ${m.template_key ?? "—"} v${m.template_version ?? "—"} · ${m.status} · ${formatDateTime(m.sent_at ?? m.created_at)}`}>
        {m.application_id ? <Link href={`/staff/applications/${m.application_id}`} className="text-sm underline">Open applicant</Link> : null}
      </PageTitle>
      {m.error ? <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{m.error}</p> : null}
      {links.length ? (
        <div className="mb-4 rounded-xl border border-border bg-card p-3 text-sm">
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Links in this email</p>
          {links.map((u) => (
            <a key={u} href={u} className="block truncate font-mono text-xs text-primary underline" target="_blank" rel="noreferrer">{u}</a>
          ))}
        </div>
      ) : null}
      <iframe title="Email" srcDoc={m.body_html} sandbox="" className="h-[720px] w-full rounded-xl border border-border bg-white" />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Plain-text version</summary>
        <pre className="mt-2 rounded-xl border border-border bg-card p-3 text-xs whitespace-pre-wrap">{m.body_text}</pre>
      </details>
    </>
  );
}
