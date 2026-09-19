import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { requireStaff } from "@/lib/staff/session";

/** Every tag in use, with how many families carry it. Tags are free text on the family; this is the index. */
export default async function TagsSettingsPage() {
  const { supabase } = await requireStaff("crm.read");
  const { data } = await supabase.from("v_crm_family_facts").select("tags").limit(20000);
  const counts = new Map<string, number>();
  for (const f of data ?? []) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Tags" description="Lower-case, letters, digits, - and _. Added on a family's page or by an automation; this is every tag in use." />
      {tags.length ? (
        <ul className="flex flex-wrap gap-2">{tags.map(([t, n]) => <li key={t}><Link href={`/staff/crm/families?tag=${encodeURIComponent(t)}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm hover:bg-muted">{t}<span className="text-xs text-muted-foreground">{n}</span></Link></li>)}</ul>
      ) : <EmptyState>No tags yet.</EmptyState>}
    </>
  );
}
