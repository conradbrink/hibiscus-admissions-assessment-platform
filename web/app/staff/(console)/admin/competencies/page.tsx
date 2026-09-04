import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireStaff } from "@/lib/staff/session";
import { addCompetency, saveCompetency } from "./actions";

export default async function CompetenciesPage() {
  const { supabase } = await requireStaff("assessments.author");
  const [{ data: subjects }, { data: competencies }] = await Promise.all([
    supabase.from("subjects").select("*").order("sort_order"),
    supabase.from("competencies").select("*").order("sort_order"),
  ]);

  return (
    <>
      <PageTitle
        title="Competencies"
        description="What every question is authored against and every learning profile reports on. Untick 'reportable' for a competency scored internally but not shown to parents."
      />
      <div className="space-y-6">
        {(subjects ?? []).map((s) => (
          <section key={s.id}>
            <h2 className="mb-2 text-sm font-semibold">{s.name}</h2>
            <div className="rounded-xl border border-border bg-card">
              <div className="grid grid-cols-[1fr_1fr_80px_90px_80px_auto] gap-2 border-b border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <span>Name</span><span>Focus label (parent-facing)</span><span>Order</span><span>Reportable</span><span>Active</span><span></span>
              </div>
              {(competencies ?? []).filter((c) => c.subject_id === s.id).map((c) => (
                <ActionForm key={c.id} action={saveCompetency} label="Save" size="xs" variant="outline" className="grid grid-cols-[1fr_1fr_80px_90px_80px_auto] items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                  <input type="hidden" name="competencyId" value={c.id} />
                  <Input name="name" defaultValue={c.name} className="h-8 md:h-8" required />
                  <Input name="focusLabel" defaultValue={c.focus_label ?? ""} className="h-8 md:h-8" />
                  <Input name="sortOrder" type="number" defaultValue={c.sort_order} className="h-8 md:h-8" />
                  <label className="text-xs"><input type="checkbox" name="reportable" value="1" defaultChecked={c.reportable} /> shown</label>
                  <label className="text-xs"><input type="checkbox" name="isActive" value="1" defaultChecked={c.is_active} /> active</label>
                </ActionForm>
              ))}
            </div>
          </section>
        ))}
        <ActionForm action={addCompetency} label="Add competency" size="sm" className="grid gap-2 rounded-xl border border-dashed border-border p-3 md:grid-cols-4">
          <NativeSelect name="subjectId" required>
            {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
          <Input name="code" placeholder="code, e.g. spelling" pattern="[a-z0-9_]+" required />
          <Input name="name" placeholder="Name" required />
          <Input name="focusLabel" placeholder="Focus label" />
        </ActionForm>
      </div>
    </>
  );
}
