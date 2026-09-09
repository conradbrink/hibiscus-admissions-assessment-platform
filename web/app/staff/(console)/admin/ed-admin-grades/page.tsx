import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { NativeSelect } from "@/components/ui/native-select";
import { ED_ADMIN } from "@/lib/enrolment/ed-admin";
import { requireStaff } from "@/lib/staff/session";
import { saveEdAdminGrades } from "../grades/actions";

/**
 * What each stage is called in Ed-admin, per campus.
 *
 * Ed-admin has no stage called "Stage 5". It has `Stage5-HPS` at Block 7 and
 * `Stage5-HLA` at Broadhurst, `NURSERY-TLK` at Tlokweng and `NURSERY_PHASE_2`
 * at Phase 2 — the stage and the site in one word, hyphenated at some sites
 * and underscored at others. Its importer matches the exact string and drops
 * anything else without a message, so a student exported with our name for
 * the stage arrived there with no stage at all, and therefore no family.
 *
 * The names live here rather than in the code because they are the school's,
 * not ours: a new site is a change on this page, not a deployment.
 */
export const dynamic = "force-dynamic";

export default async function EdAdminGradesPage() {
  const { supabase } = await requireStaff("settings.write");

  const [{ data: campuses }, { data: grades }, { data: pairs }] = await Promise.all([
    supabase.from("campuses").select("id, name, is_active").order("name"),
    supabase.from("grades").select("id, name, sort_order").order("sort_order"),
    supabase.from("campus_grades").select("campus_id, grade_id, external_grade_code, is_active"),
  ]);

  const gradeById = new Map((grades ?? []).map((g) => [g.id, g]));
  const byCampus = new Map<string, Array<{ gradeId: string; name: string; sort: number; code: string | null }>>();
  for (const p of pairs ?? []) {
    if (!p.is_active) continue;
    const g = gradeById.get(p.grade_id);
    if (!g) continue;
    const list = byCampus.get(p.campus_id) ?? [];
    list.push({ gradeId: p.grade_id, name: g.name, sort: g.sort_order, code: p.external_grade_code });
    byCampus.set(p.campus_id, list);
  }
  for (const list of byCampus.values()) list.sort((a, b) => a.sort - b.sort);

  const unmapped = [...byCampus.values()].flat().filter((r) => !r.code).length;

  return (
    <>
      <PageTitle
        back={{ href: "/staff/admin", label: "Settings" }}
        title="Ed-admin stage names"
        description="What each stage is called in the school's other system. Copy the name from Ed-admin's own Grade list exactly — its importer matches the whole word and ignores anything it does not recognise."
      />

      {unmapped > 0 ? (
        <p className="surface mb-4 border-destructive/40 p-3 text-sm">
          <strong>{unmapped}</strong> {unmapped === 1 ? "stage has" : "stages have"} no Ed-admin name yet. The student
          export will refuse to send a child in one of them rather than import them without a stage.
        </p>
      ) : null}

      <div className="space-y-6">
        {(campuses ?? []).map((campus) => {
          const rows = byCampus.get(campus.id) ?? [];
          if (!rows.length) return null;
          return (
            <section key={campus.id} className="surface p-4">
              <h2 className="text-sm font-semibold">
                {campus.name}
                {campus.is_active ? "" : <span className="ml-2 text-xs font-normal text-muted-foreground">(not taking enquiries)</span>}
              </h2>
              <ActionForm action={saveEdAdminGrades} label="Save names" size="sm" variant="outline" className="mt-3">
                <input type="hidden" name="campusId" value={campus.id} />
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-1 font-medium">Our stage</th>
                      <th className="pb-1 font-medium">Called this in Ed-admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.gradeId}>
                        <td className="py-1 pr-3 align-middle">{r.name}</td>
                        <td className="py-1">
                          <NativeSelect name={`code:${r.gradeId}`} defaultValue={r.code ?? ""} aria-label={`${campus.name} ${r.name} in Ed-admin`}>
                            <option value="">Not set</option>
                            {ED_ADMIN.grades.map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </NativeSelect>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ActionForm>
            </section>
          );
        })}
      </div>
    </>
  );
}
