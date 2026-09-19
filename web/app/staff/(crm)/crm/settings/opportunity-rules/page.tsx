import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { describeConditions, parseConditions } from "@/lib/crm/opportunities/rules";
import { formatDateTime } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import type { OpportunityRuleRow } from "@/lib/supabase/types";
import { saveCrmSetting, saveOpportunityRule } from "../actions";

function Row({ r, types, grades }: { r?: OpportunityRuleRow; types: Array<{ code: string; name: string }>; grades: Array<{ name: string; sort_order: number }> }) {
  const gradeName = (sort: number) => grades.find((g) => g.sort_order === sort)?.name ?? null;
  return (
    <ActionForm action={saveOpportunityRule} label={r ? "Save" : "Add rule"} size="xs" variant="outline" resetOnSubmit={!r} className="surface space-y-2 px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-[140px_1fr_160px_100px_70px_auto] sm:items-center">
        <Input name="code" defaultValue={r?.code ?? ""} placeholder="code" readOnly={!!r} className="h-8 font-mono text-xs md:h-8" required />
        <div className="space-y-1"><Input name="name" defaultValue={r?.name ?? ""} placeholder="Name" className="h-8 md:h-8" required /><Input name="description" defaultValue={r?.description ?? ""} placeholder="Description" className="h-8 text-xs md:h-8" /></div>
        <NativeSelect name="typeCode" defaultValue={r?.type_code ?? types?.[0]?.code ?? ""} className="h-8 md:h-8" aria-label="Type">{types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</NativeSelect>
        <Input name="estimatedValue" defaultValue={r?.estimated_value_minor !== null && r?.estimated_value_minor !== undefined ? String(r.estimated_value_minor / 100) : ""} placeholder="Value" className="h-8 md:h-8" aria-label="Value" />
        <Input name="sortOrder" type="number" defaultValue={r?.sort_order ?? 100} className="h-8 md:h-8" aria-label="Order" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={r?.is_active ?? false} /> Active</label>
      </div>
      <Textarea name="conditions" rows={2} defaultValue={r ? JSON.stringify(r.conditions) : '{"subject": "student", "grade_sort_min": 90, "grade_sort_max": 120, "not_registered_item": "robotics"}'} className="font-mono text-xs" />
      {r ? <p className="text-xs text-muted-foreground">{describeConditions(parseConditions(r.conditions), gradeName)}{r.last_run_at ? ` · last run ${formatDateTime(r.last_run_at)}, created ${r.last_run_created ?? 0}` : " · never run"}</p> : null}
    </ActionForm>
  );
}

export default async function OpportunityRulesPage() {
  const { supabase } = await requireStaff("settings.write");
  const [{ data: rules }, { data: types }, { data: grades }, settings] = await Promise.all([
    supabase.from("opportunity_rules").select("*").order("sort_order"),
    supabase.from("opportunity_types").select("code, name").order("sort_order"),
    supabase.from("grades").select("name, sort_order").order("sort_order"),
    getSettings(supabase),
  ]);
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Opportunity rules" description="How the engine finds a family to offer something to. Conditions are JSON: subject (student or family), grade_sort_min and max, campus_ids, student_statuses, not_registered_item, multiple_children_one_enrolled, reenrolment_outstanding.">
        <Badge variant={settings.crmOpportunityEngineEnabled ? "success" : "muted"}>Engine {settings.crmOpportunityEngineEnabled ? "on" : "off"}</Badge>
      </PageTitle>
      <ActionForm action={saveCrmSetting} label="Save" size="xs" variant="outline" resetOnSubmit={false} className="mb-4 flex flex-wrap items-center gap-2 surface px-4 py-3">
        <input type="hidden" name="key" value="crm_opportunity_engine_enabled" />
        <span className="text-sm">Run the rules once a day (crm_opportunity_engine_enabled)</span>
        <Input name="value" defaultValue={String(settings.crmOpportunityEngineEnabled)} className="h-8 w-20 font-mono md:h-8" />
      </ActionForm>
      <p className="mb-3 text-xs text-muted-foreground">Grades by sort order: {(grades ?? []).map((g) => `${g.name} = ${g.sort_order}`).join(", ")}.</p>
      <div className="space-y-2">{(rules ?? []).map((r) => <Row key={r.code} r={r} types={types ?? []} grades={grades ?? []} />)}<Row types={types ?? []} grades={grades ?? []} /></div>
    </>
  );
}
