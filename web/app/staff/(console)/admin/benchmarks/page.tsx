import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { parseBenchmarkBands } from "@/lib/assessment/bands";
import { requireStaff } from "@/lib/staff/session";
import { saveBenchmark } from "./actions";

export default async function BenchmarksPage() {
  const { supabase } = await requireStaff("assessments.author");
  const [{ data: benchmarks }, { data: subjects }, { data: competencies }, { data: grades }] = await Promise.all([
    supabase.from("benchmarks").select("*").order("scope").order("grade_sort_min"),
    supabase.from("subjects").select("id, name").order("sort_order"),
    supabase.from("competencies").select("id, name").order("sort_order"),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
  ]);
  const scopeName = (scope: string, id: string | null) =>
    scope === "overall" ? "Overall" : scope === "subject" ? `Subject: ${subjects?.find((s) => s.id === id)?.name ?? "?"}` : `Competency: ${competencies?.find((c) => c.id === id)?.name ?? "?"}`;
  const gradeName = (sort: number | null) => (sort === null ? "any" : grades?.find((g) => g.sort_order === sort)?.name ?? String(sort));

  const Floors = ({ bands }: { bands: ReturnType<typeof parseBenchmarkBands> }) => {
    const floor = (key: string) => bands.find((b) => b.key === key)?.min_percent ?? 0;
    return (
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs">Approaching from %<Input name="approaching" type="number" min={1} max={100} defaultValue={floor("approaching")} className="h-8 md:h-8" /></label>
        <label className="text-xs">Meeting from %<Input name="meeting" type="number" min={1} max={100} defaultValue={floor("meeting")} className="h-8 md:h-8" /></label>
        <label className="text-xs">Exceeding from %<Input name="exceeding" type="number" min={1} max={100} defaultValue={floor("exceeding")} className="h-8 md:h-8" /></label>
      </div>
    );
  };

  return (
    <>
      <PageTitle
        title="Benchmarks"
        description="How a percentage becomes a word on the learning profile: below, approaching, meeting, exceeding. The most specific active row wins. These are presentation only — admission criteria live in Admission rules."
      />
      <div className="space-y-4">
        {(benchmarks ?? []).map((b) => (
          <ActionForm key={b.id} action={saveBenchmark} label="Save" size="sm" variant="outline" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <input type="hidden" name="benchmarkId" value={b.id} />
            <input type="hidden" name="scope" value={b.scope} />
            <input type="hidden" name="scopeId" value={b.scope_id ?? ""} />
            <input type="hidden" name="gradeSortMin" value={b.grade_sort_min ?? ""} />
            <input type="hidden" name="gradeSortMax" value={b.grade_sort_max ?? ""} />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{scopeName(b.scope, b.scope_id)}</span>
              <span className="text-xs text-muted-foreground">grades {gradeName(b.grade_sort_min)} – {gradeName(b.grade_sort_max)}</span>
              <label className="ml-auto text-xs"><input type="checkbox" name="isActive" value="1" defaultChecked={b.is_active} /> active</label>
            </div>
            <Floors bands={parseBenchmarkBands(b.bands)} />
            <Input name="description" defaultValue={b.description ?? ""} placeholder="Note" className="h-8 md:h-8" />
          </ActionForm>
        ))}
        <ActionForm action={saveBenchmark} label="Add benchmark" size="sm" className="space-y-3 rounded-xl border border-dashed border-border p-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <NativeSelect name="scope" defaultValue="subject"><option value="overall">Overall</option><option value="subject">Subject</option><option value="competency">Competency</option></NativeSelect>
            <NativeSelect name="scopeId" defaultValue="">
              <option value="">— which —</option>
              {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>Subject: {s.name}</option>)}
              {(competencies ?? []).map((c) => <option key={c.id} value={c.id}>Competency: {c.name}</option>)}
            </NativeSelect>
            <NativeSelect name="gradeSortMin" defaultValue=""><option value="">From any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
            <NativeSelect name="gradeSortMax" defaultValue=""><option value="">To any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
          </div>
          <Floors bands={parseBenchmarkBands(null)} />
          <Input name="description" placeholder="Note (optional)" className="h-8 md:h-8" />
        </ActionForm>
      </div>
    </>
  );
}
