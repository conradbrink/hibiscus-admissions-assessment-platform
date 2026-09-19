import { RuleBuilder } from "@/components/crm/rule-builder";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SEGMENT_PRESETS } from "@/lib/crm/segments";
import { requireStaff } from "@/lib/staff/session";
import { createSegment } from "../actions";

export default async function NewSegmentPage({ searchParams }: { searchParams: Promise<{ preset?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("crm.campaigns.write");
  const preset = SEGMENT_PRESETS.find((p) => p.key === sp.preset) ?? null;
  const [{ data: campuses }, { data: grades }, { data: staff }, { data: types }, { data: items }] = await Promise.all([
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("grades").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("opportunity_types").select("code, name").eq("is_active", true).order("sort_order"),
    supabase.from("optional_items").select("code, label").eq("is_active", true).order("label"),
  ]);
  const distinctItems = [...new Map((items ?? []).map((i) => [i.code, i])).values()];
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/segments", label: "Segments" }} title="New segment" description="Every rule must hold. The count is shown once it is saved, and again whenever you look." />
      <ActionForm action={createSegment} label="Save segment" size="lg" resetOnSubmit={false} className="max-w-3xl space-y-4">
        <div className="surface grid gap-3 p-5 sm:grid-cols-2">
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Name</span><Input name="name" defaultValue={preset?.name ?? ""} required maxLength={120} /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus</span>
            <NativeSelect name="campusId" defaultValue=""><option value="">Every campus I can see</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Description</span><Input name="description" defaultValue={preset?.description ?? ""} maxLength={500} /></label>
        </div>
        <div className="surface p-5">
          <h2 className="mb-2 text-sm font-semibold">Rules</h2>
          <RuleBuilder initial={preset?.rules ?? []} lookups={{ campuses: campuses ?? [], grades: grades ?? [], staff: staff ?? [], opportunityTypes: types ?? [], items: distinctItems }} />
        </div>
      </ActionForm>
    </>
  );
}
