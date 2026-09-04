import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { requireStaff } from "@/lib/staff/session";
import { saveCampusGrades, saveGrade } from "./actions";

export default async function GradesPage() {
  const { supabase } = await requireStaff("settings.write");
  const [{ data: grades }, { data: campuses }, { data: matrix }] = await Promise.all([
    supabase.from("grades").select("*").order("sort_order"),
    supabase.from("campuses").select("id, name, is_active").order("sort_order"),
    supabase.from("campus_grades").select("campus_id, grade_id"),
  ]);
  const offered = new Set((matrix ?? []).map((m) => `${m.campus_id}:${m.grade_id}`));

  return (
    <>
      <PageTitle
        title="Grades"
        description="The age rule is 'turning N before the cut-off'. Grades without an assessment skip that step entirely. Seeded from the current website; the contradictions in it are flagged in PROJECT-CONTEXT.md."
      />
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Grade</th>
              <th className="px-3 py-2 font-medium">Phase</th>
              <th className="px-3 py-2 font-medium">Turning</th>
              <th className="px-3 py-2 font-medium">Assessment</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(grades ?? []).map((g) => (
              <tr key={g.id}>
                <td colSpan={6} className="p-0">
                  <ActionForm action={saveGrade} label="Save" size="xs" variant="outline" className="grid grid-cols-[1fr_100px_80px_110px_80px_auto] items-center gap-2 px-3 py-1.5">
                    <input type="hidden" name="gradeId" value={g.id} />
                    <Input name="name" defaultValue={g.name} className="h-8 md:h-8" />
                    <span className="text-xs text-muted-foreground">{g.phase}</span>
                    <Input name="ageTurning" type="number" min={0} max={20} defaultValue={g.age_turning ?? ""} placeholder="—" className="h-8 md:h-8" />
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="requiresAssessment" value="1" defaultChecked={g.requires_assessment} /> required</label>
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="isActive" value="1" defaultChecked={g.is_active} /> active</label>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-2 text-sm font-semibold">Which grades each campus offers</h2>
      <p className="mb-3 text-xs text-muted-foreground">Parents are only ever offered ticked combinations. This is what stops a Form 4 application at a pre-school.</p>
      <div className="space-y-3">
        {(campuses ?? []).map((c) => (
          <ActionForm key={c.id} action={saveCampusGrades} label="Save" size="xs" variant="outline" className="rounded-xl border border-border bg-card p-3">
            <input type="hidden" name="campusId" value={c.id} />
            <p className="mb-2 text-sm font-medium">{c.name}{!c.is_active ? <span className="ml-2 text-xs text-muted-foreground">(inactive)</span> : null}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {(grades ?? []).map((g) => (
                <label key={g.id} className="flex items-center gap-1.5"><input type="checkbox" name="gradeIds" value={g.id} defaultChecked={offered.has(`${c.id}:${g.id}`)} /> {g.name}</label>
              ))}
            </div>
          </ActionForm>
        ))}
      </div>
    </>
  );
}
