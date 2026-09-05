import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { createRuleset } from "./actions";

export default async function RulesPage() {
  const { supabase } = await requireStaff("rules.write");
  const [{ data: rulesets }, { data: grades }, { data: campuses }] = await Promise.all([
    supabase
      .from("admission_rulesets")
      .select("*, campuses(name), admission_rules(id)")
      .order("status")
      .order("created_at", { ascending: false }),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  const gradeName = (sort: number | null) => (sort === null ? "any" : grades?.find((g) => g.sort_order === sort)?.name ?? String(sort));
  const active = (rulesets ?? []).filter((r) => r.status === "active");

  return (
    <>
      <PageTitle
        title="Admission rules"
        description="What the scores must meet. The engine is deterministic: a hard-fail rule violated declines; a review rule violated refers to a person; everything met approves, or waitlists when the grade is full. With no active ruleset, every assessed applicant is referred to a person."
      />
      {!active.length ? (
        <p className="mb-4 rounded-md bg-warning/20 px-3 py-2 text-sm text-warning-foreground">No ruleset is active. Every assessed applicant is currently routed to staff review — the safe default, but a person has to decide each one.</p>
      ) : null}
      <ActionForm action={createRuleset} label="Create draft ruleset" size="sm" className="mb-5 grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-5">
        <Input name="name" placeholder="Name, e.g. Primary entry 2027" required className="md:col-span-2" />
        <NativeSelect name="gradeSortMin" defaultValue=""><option value="">From any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
        <NativeSelect name="gradeSortMax" defaultValue=""><option value="">To any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
        <NativeSelect name="campusId" defaultValue=""><option value="">Every campus</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}</NativeSelect>
        <Input name="description" placeholder="Why these thresholds (optional)" className="md:col-span-5" />
      </ActionForm>
      {rulesets?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rulesets.map((r) => {
            const campus = Array.isArray(r.campuses) ? r.campuses[0] : r.campuses;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/admin/rules/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                  <p className="text-xs text-muted-foreground">
                    {gradeName(r.grade_sort_min)} – {gradeName(r.grade_sort_max)} · {(campus as { name: string } | null)?.name ?? "every campus"} · {r.admission_rules?.length ?? 0} rule{(r.admission_rules?.length ?? 0) === 1 ? "" : "s"} · v{r.version}
                    {r.activated_at ? ` · active since ${formatDate(r.activated_at)}` : ""}
                  </p>
                </div>
                <Badge variant={r.status === "active" ? "success" : r.status === "superseded" ? "muted" : "outline"}>{r.status}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>No rulesets yet. Create a draft, add rules, activate it.</EmptyState>
      )}
    </>
  );
}
