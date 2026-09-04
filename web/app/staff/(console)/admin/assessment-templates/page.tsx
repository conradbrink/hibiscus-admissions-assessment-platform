import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireStaff } from "@/lib/staff/session";
import { createTemplate } from "./actions";

export default async function TemplatesPage() {
  const { supabase } = await requireStaff("assessments.author");
  const [{ data: templates }, { data: grades }, { data: campuses }] = await Promise.all([
    supabase.from("assessment_templates").select("*, campuses(name)").order("grade_sort_min").order("created_at"),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  const gradeName = (sort: number) => grades?.find((g) => g.sort_order === sort)?.name ?? String(sort);

  return (
    <>
      <PageTitle
        title="Assessment templates"
        description="What a sitting is made of. At launch the active template whose grade band contains the child's grade is used, preferring one pinned to the campus. Sections draw fixed questions or random ones by competency and difficulty."
      />
      <ActionForm action={createTemplate} label="Create template" size="sm" className="mb-5 grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-5">
        <Input name="name" placeholder="Name, e.g. Primary Stage 1–6" required className="md:col-span-2" />
        <NativeSelect name="gradeSortMin" required>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
        <NativeSelect name="gradeSortMax" required>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
        <Input name="timeLimitMinutes" type="number" min={5} max={300} defaultValue={60} title="Time limit, minutes" />
        <NativeSelect name="campusId" defaultValue="" className="md:col-span-2"><option value="">Every campus</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}</NativeSelect>
        <Input name="description" placeholder="Description (optional)" className="md:col-span-3" />
      </ActionForm>
      {templates?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {templates.map((t) => {
            const campus = Array.isArray(t.campuses) ? t.campuses[0] : t.campuses;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/admin/assessment-templates/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                  <p className="text-xs text-muted-foreground">
                    {gradeName(t.grade_sort_min)} – {gradeName(t.grade_sort_max)} · {(campus as { name: string } | null)?.name ?? "every campus"} · {t.time_limit_minutes} min · v{t.version}
                  </p>
                </div>
                <Badge variant={t.status === "active" ? "success" : t.status === "retired" ? "muted" : "outline"}>{t.status}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>No templates yet. A sitting cannot be launched until one is active for the child&apos;s grade.</EmptyState>
      )}
    </>
  );
}
