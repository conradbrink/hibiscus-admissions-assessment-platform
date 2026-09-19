import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/staff/session";

const KIND_LABELS: Record<string, string> = { family: "Families", contact: "Contacts", student: "Students", applicant: "Applicants" };
const KIND_ORDER = ["family", "contact", "student", "applicant"];

/**
 * One search across everything, grouped by what each result is. Under the
 * caller's own rights (`crm_search` is security invoker), so a family at a
 * campus they cannot see is not a result.
 */
export default async function CrmSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("crm.read");
  const q = (sp.q ?? "").trim();
  const { data } = q.length >= 2 ? await supabase.rpc("crm_search", { p_q: q, p_limit: 10 }) : { data: [] };
  const groups = KIND_ORDER.map((kind) => ({ kind, rows: (data ?? []).filter((r) => r.kind === kind) })).filter((g) => g.rows.length);

  return (
    <>
      <PageTitle title="Search" description="A family, a parent, a child, a phone number, an email address, a student code or an application reference." />
      <form method="get" className="mb-6 flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Brink, +267 71…, brink@…, HBS-S-00012, HBS-2026-00045" className="max-w-xl" autoFocus />
        <Button type="submit" size="lg">Search</Button>
      </form>
      {q.length < 2 ? (
        <EmptyState>Type at least two characters.</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState>Nothing matches &ldquo;{q}&rdquo;.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <section key={g.kind} className="surface">
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <h2 className="font-semibold">{KIND_LABELS[g.kind]}</h2>
                <span className="text-xs text-muted-foreground">{g.rows.length} result{g.rows.length === 1 ? "" : "s"}</span>
              </div>
              <ul className="divide-y divide-border/70">
                {g.rows.map((r) => (
                  <li key={`${r.kind}:${r.id}`}>
                    <Link href={r.href} className="block px-5 py-2.5 text-sm hover:bg-muted/50">
                      <span className="font-medium">{r.title}</span>
                      <span className="block text-xs text-muted-foreground">{r.subtitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
