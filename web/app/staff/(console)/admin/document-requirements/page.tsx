import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireStaff } from "@/lib/staff/session";
import { saveRequirement } from "./actions";

export default async function DocumentRequirementsPage() {
  const { supabase } = await requireStaff("settings.write");
  const [{ data: requirements }, { data: grades }] = await Promise.all([
    supabase.from("document_requirements").select("*").order("sort_order"),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
  ]);
  const form = (r: NonNullable<typeof requirements>[number] | null) => (
    <ActionForm key={r?.code ?? "new"} action={saveRequirement} label={r ? "Save" : "Add"} size="sm" variant={r ? "outline" : "default"} className="grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-[140px_1fr_1fr_110px_110px_70px_auto]">
      {r ? <input type="hidden" name="code" value={r.code} /> : <Input name="code" placeholder="code" pattern="[a-z0-9_]+" required className="h-8 font-mono text-xs md:h-8" />}
      {r ? <span className="self-center font-mono text-xs text-muted-foreground">{r.code}</span> : null}
      <Input name="label" defaultValue={r?.label ?? ""} placeholder="Label parents see" required className="h-8 md:h-8" />
      <Input name="description" defaultValue={r?.description ?? ""} placeholder="Description" className="h-8 md:h-8" />
      <NativeSelect name="gradeSortMin" defaultValue={r?.grade_sort_min ?? ""} className="h-8 md:h-8"><option value="">Any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
      <NativeSelect name="gradeSortMax" defaultValue={r?.grade_sort_max ?? ""} className="h-8 md:h-8"><option value="">to any</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
      <Input name="sortOrder" type="number" defaultValue={r?.sort_order ?? 0} className="h-8 md:h-8" />
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" name="required" value="1" defaultChecked={r ? r.required : true} /> required</label>
        <label className="flex items-center gap-1"><input type="checkbox" name="isActive" value="1" defaultChecked={r ? r.is_active : true} /> active</label>
        <input type="hidden" name="isActive" value="0" />
      </div>
    </ActionForm>
  );
  return (
    <>
      <PageTitle title="Document requirements" description="What a family must upload at registration, and for which grades. A required document that is missing or rejected holds enrolment; an optional one never does." />
      <div className="space-y-3">
        {(requirements ?? []).map((r) => form(r))}
        <h2 className="pt-2 text-sm font-semibold">Add a requirement</h2>
        {form(null)}
      </div>
    </>
  );
}
