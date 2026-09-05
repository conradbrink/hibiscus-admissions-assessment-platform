import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

export default async function TemplatesPage() {
  const { supabase } = await requireStaff("templates.write");
  const { data: templates } = await supabase
    .from("email_templates")
    .select("key, version, name, description, subject, updated_at")
    .eq("is_active", true)
    .order("key");

  return (
    <>
      <PageTitle title="Email templates" description="Every email a parent receives. Editing publishes a new version; old versions are kept." />
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {(templates ?? []).map((t) => (
          <li key={t.key} className="px-4 py-3 text-sm">
            <Link href={`/staff/admin/templates/${t.key}`} className="font-medium hover:underline">{t.name}</Link>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{t.key} · v{t.version}</span>
            <p className="text-muted-foreground">{t.description}</p>
            <p className="text-xs text-muted-foreground">Subject: {t.subject} · updated {formatDate(t.updated_at)}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
