import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";
import type { OpportunityTypeRow } from "@/lib/supabase/types";
import { saveOpportunityType } from "../actions";

const CATEGORIES = ["activity", "service", "programme", "enrolment", "other"] as const;

function Row({ t, codes }: { t?: OpportunityTypeRow; codes: Array<{ code: string; label: string }> }) {
  return (
    <ActionForm action={saveOpportunityType} label={t ? "Save" : "Add"} size="xs" variant="outline" resetOnSubmit={!t} className="surface grid gap-2 px-4 py-3 sm:grid-cols-[110px_1fr_110px_120px_150px_60px_auto] sm:items-center">
      <Input name="code" defaultValue={t?.code ?? ""} placeholder="code" readOnly={!!t} className="h-8 font-mono text-xs md:h-8" required />
      <div className="space-y-1"><Input name="name" defaultValue={t?.name ?? ""} placeholder="Name" className="h-8 md:h-8" required /><Input name="description" defaultValue={t?.description ?? ""} placeholder="Description" className="h-8 text-xs md:h-8" /></div>
      <NativeSelect name="category" defaultValue={t?.category ?? "other"} className="h-8 md:h-8" aria-label="Category">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect>
      <Input name="defaultValue" defaultValue={t?.default_value_minor !== null && t?.default_value_minor !== undefined ? String(t.default_value_minor / 100) : ""} placeholder="Value" className="h-8 md:h-8" aria-label="Default value" />
      <NativeSelect name="optionalItemCode" defaultValue={t?.optional_item_code ?? ""} className="h-8 md:h-8" aria-label="Catalogue code"><option value="">No catalogue item</option>{codes.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}{t?.optional_item_code && !codes.some((c) => c.code === t.optional_item_code) ? <option value={t.optional_item_code}>{t.optional_item_code} (not in the catalogue yet)</option> : null}</NativeSelect>
      <Input name="sortOrder" type="number" defaultValue={t?.sort_order ?? 100} className="h-8 md:h-8" aria-label="Order" />
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={t?.is_active ?? true} /> Active</label>
    </ActionForm>
  );
}

export default async function OpportunityTypesPage() {
  const { supabase } = await requireStaff("settings.write");
  const [{ data: types }, { data: items }] = await Promise.all([
    supabase.from("opportunity_types").select("*").order("sort_order"),
    supabase.from("optional_items").select("code, label").eq("is_active", true).order("label"),
  ]);
  const codes = [...new Map((items ?? []).map((i) => [i.code, i])).values()];
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Opportunity types" description="What the school offers beyond the place. A value is what one conversion is worth; a catalogue code says which optional item means the family took it up, so the engine can close the loop itself." />
      <div className="mb-2 hidden gap-2 px-4 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:grid sm:grid-cols-[110px_1fr_110px_120px_150px_60px_auto]"><span>Code</span><span>Name</span><span>Category</span><span>Value</span><span>Catalogue item</span><span>Order</span><span /></div>
      <div className="space-y-2">{(types ?? []).map((t) => <Row key={t.code} t={t} codes={codes} />)}<Row codes={codes} /></div>
      <p className="mt-3 text-xs text-muted-foreground">Values are in the campus currency of each opportunity; {types?.[0]?.default_value_minor ? `for example ${formatMoney(types[0].default_value_minor, "BWP")}` : "leave blank for \"not costed\""}. The catalogue itself is edited under Admissions → Settings → Optional extras, per campus, with a real price.</p>
    </>
  );
}
