import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { parseRubricBands } from "@/lib/assessment/bands";
import { requireStaff } from "@/lib/staff/session";
import type { RubricBand } from "@/lib/supabase/types";
import { saveRubric } from "./actions";

const BLANK: RubricBand[] = [
  { key: "emerging", label: "Emerging", min_marks: 0, descriptor: "" },
  { key: "developing", label: "Developing", min_marks: 3, descriptor: "" },
  { key: "secure", label: "Secure", min_marks: 6, descriptor: "" },
  { key: "extending", label: "Extending", min_marks: 9, descriptor: "" },
];

function BandRows({ bands }: { bands: RubricBand[] }) {
  const rows = [...bands, { key: "", label: "", min_marks: 0, descriptor: "" }];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[110px_140px_80px_1fr] gap-2 text-xs text-muted-foreground"><span>Key</span><span>Label</span><span>Min marks</span><span>What earns this band</span></div>
      {rows.map((b, i) => (
        <div key={i} className="grid grid-cols-[110px_140px_80px_1fr] gap-2">
          <Input name="bandKey" defaultValue={b.key} placeholder="key" pattern="[a-z0-9_]*" className="h-8 md:h-8" />
          <Input name="bandLabel" defaultValue={b.label} placeholder="Label" className="h-8 md:h-8" />
          <Input name="bandMin" type="number" step="0.5" min={0} defaultValue={b.key ? b.min_marks : ""} className="h-8 md:h-8" />
          <Textarea name="bandDescriptor" rows={2} defaultValue={b.descriptor} placeholder="Descriptor the assessor (and the AI suggestion) reads" className="min-h-8 text-xs" />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Leave the last row empty unless adding a band. A row with nothing in it is ignored.</p>
    </div>
  );
}

export default async function RubricsPage() {
  const { supabase } = await requireStaff("assessments.author");
  const [{ data: rubrics }, { data: competencies }] = await Promise.all([
    supabase.from("rubrics").select("*").order("name"),
    supabase.from("competencies").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  return (
    <>
      <PageTitle
        title="Writing rubrics"
        description="How extended writing is marked. An assessor reads the child's writing and picks a band; the band's minimum marks are awarded. The AI may suggest a band from the same descriptors, and never awards one."
      />
      <div className="space-y-4">
        {(rubrics ?? []).map((r) => (
          <ActionForm key={r.id} action={saveRubric} label="Save rubric" size="sm" variant="outline" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <input type="hidden" name="rubricId" value={r.id} />
            <div className="grid gap-2 sm:grid-cols-3">
              <Input name="name" defaultValue={r.name} required />
              <NativeSelect name="competencyId" defaultValue={r.competency_id}>
                {(competencies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
              <Input name="maxMarks" type="number" step="0.5" min={1} defaultValue={r.max_marks} title="Maximum marks" />
            </div>
            <BandRows bands={parseRubricBands(r.bands)} />
          </ActionForm>
        ))}
        <ActionForm action={saveRubric} label="Create rubric" size="sm" className="space-y-3 rounded-xl border border-dashed border-border p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input name="name" placeholder="Rubric name, e.g. Stage 4 narrative writing" required />
            <NativeSelect name="competencyId">
              {(competencies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
            <Input name="maxMarks" type="number" step="0.5" min={1} defaultValue={10} title="Maximum marks" />
          </div>
          <BandRows bands={BLANK} />
        </ActionForm>
      </div>
    </>
  );
}
