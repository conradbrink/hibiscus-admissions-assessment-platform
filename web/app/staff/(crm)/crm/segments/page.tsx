import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { describeRule, SEGMENT_PRESETS } from "@/lib/crm/segments";
import { parseRules } from "@/lib/crm/segments-server";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Saved audiences, each with its rules in words and its last count. */
export default async function SegmentsPage() {
  const { supabase, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.campaigns.write");
  const [{ data: segments }, { data: campuses }, { data: grades }, { data: staff }] = await Promise.all([
    supabase.from("segments").select("*, campuses(name), staff_profiles!segments_created_by_fkey(full_name)").order("name"),
    supabase.from("campuses").select("id, name"),
    supabase.from("grades").select("id, name"),
    supabase.from("staff_profiles").select("id, full_name"),
  ]);
  const lookups = {
    campus: (id: string) => campuses?.find((c) => c.id === id)?.name ?? id,
    grade: (id: string) => grades?.find((g) => g.id === id)?.name ?? id,
    staff: (id: string) => staff?.find((s) => s.id === id)?.full_name ?? id,
  };
  return (
    <>
      <PageTitle title="Segments" description="Saved audiences: rules over families, counted when you look. Every campaign is sent to one.">
        {canWrite ? <Link href="/staff/crm/segments/new" className={buttonVariants({ size: "lg" })}>New segment</Link> : null}
      </PageTitle>
      {segments?.length ? (
        <ul className="space-y-2">
          {segments.map((s) => (
            <li key={s.id} className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/staff/crm/segments/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                <span className="ml-2 text-xs text-muted-foreground">{one(s.campuses)?.name ?? "Every campus"}{s.description ? ` · ${s.description}` : ""}</span>
                <p className="text-xs text-muted-foreground">{parseRules(s.rules).map((r) => describeRule(r, lookups)).join(" and ") || "no rules"}</p>
              </div>
              <span className="text-right text-xs text-muted-foreground"><span className="block text-lg font-semibold text-foreground tabular-nums">{s.match_count ?? "—"}</span>families{s.counted_at ? ` · ${formatDateTime(s.counted_at)}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No segments yet.</EmptyState>
      )}
      {canWrite ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Start from an example</h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {SEGMENT_PRESETS.map((p) => (
              <li key={p.key}>
                <Link href={`/staff/crm/segments/new?preset=${p.key}`} className="surface block px-4 py-3 text-sm transition-shadow hover:shadow-lift">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
