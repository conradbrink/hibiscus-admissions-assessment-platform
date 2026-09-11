import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { optionsOf } from "@/lib/extras/catalogue";
import { formatMoney } from "@/lib/money";
import { minorToDecimal } from "@/lib/payments/amounts";
import { requireStaff } from "@/lib/staff/session";
import { saveOptionalItem } from "./actions";

export const metadata = { title: "Optional extras" };

const CATEGORIES = ["stationery", "transport", "lunch", "aftercare", "uniform", "other"] as const;

/**
 * The catalogue of extras a family can order during onboarding.
 *
 * Priced per campus on purpose: Potchefstroom charges in rand and the
 * Botswana campuses in pula, and one amount cannot be both. The currency
 * follows the campus and is never typed in here.
 */
export default async function OptionalItemsPage() {
  const { supabase } = await requireStaff("settings.write");
  const [{ data: items }, { data: campuses }, { data: grades }] = await Promise.all([
    supabase.from("optional_items").select("*, campuses(name)").order("campus_id").order("sort_order"),
    supabase.from("campuses").select("id, name, currency").eq("is_active", true).order("sort_order"),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
  ]);

  const form = (i: NonNullable<typeof items>[number] | null) => (
    <ActionForm
      key={i?.id ?? "new"}
      action={saveOptionalItem}
      label={i ? "Save" : "Add"}
      size="sm"
      variant={i ? "outline" : "default"}
      className="surface grid gap-2 p-3 md:grid-cols-[150px_150px_1fr_120px_110px_110px_110px_auto]"
    >
      {i ? <input type="hidden" name="id" value={i.id} /> : null}
      <NativeSelect name="campusId" defaultValue={i?.campus_id ?? ""} required className="h-8 md:h-8">
        <option value="">Campus…</option>
        {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
      </NativeSelect>
      {i ? (
        <span className="self-center font-mono text-xs text-muted-foreground">{i.code}</span>
      ) : (
        <Input name="code" placeholder="code" pattern="[a-z0-9_]+" required className="h-8 font-mono text-xs md:h-8" />
      )}
      {i ? <input type="hidden" name="code" value={i.code} /> : null}
      <Input name="label" defaultValue={i?.label ?? ""} placeholder="What parents see" required className="h-8 md:h-8" />
      <NativeSelect name="category" defaultValue={i?.category ?? "other"} className="h-8 md:h-8">
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </NativeSelect>
      <Input name="amount" defaultValue={i ? minorToDecimal(i.amount_minor) : ""} placeholder="Price" required className="h-8 md:h-8" aria-label="Price" />
      <NativeSelect name="gradeSortMin" defaultValue={i?.grade_sort_min ?? ""} className="h-8 md:h-8">
        <option value="">Any grade</option>
        {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}
      </NativeSelect>
      <NativeSelect name="gradeSortMax" defaultValue={i?.grade_sort_max ?? ""} className="h-8 md:h-8">
        <option value="">to any</option>
        {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}
      </NativeSelect>
      <Input name="sortOrder" type="number" defaultValue={i?.sort_order ?? 0} className="h-8 md:h-8" aria-label="Sort order" />

      <div className="md:col-span-4">
        <Input name="description" defaultValue={i?.description ?? ""} placeholder="A sentence of detail, optional" className="h-8 md:h-8" />
      </div>
      <div className="md:col-span-2">
        <Input name="orderBy" type="date" defaultValue={i?.order_by ?? ""} className="h-8 md:h-8" aria-label="Order by" />
        <p className="mt-1 text-[11px] text-muted-foreground">Order by — after this, parents can read about it but not order it.</p>
      </div>
      <div className="md:col-span-2 flex flex-col gap-1 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" name="allowQuantity" value="1" defaultChecked={i ? i.allow_quantity : false} /> more than one allowed</label>
        <label className="flex items-center gap-1"><input type="checkbox" name="isActive" value="1" defaultChecked={i ? i.is_active : true} /> active</label>
      </div>
      <div className="md:col-span-8">
        <Textarea name="options" defaultValue={optionsOf(i?.options).join("\n")} rows={2} placeholder="Options, one per line — a transport route, a lunch plan. Leave empty when there is nothing to choose." className="text-xs" aria-label="Options" />
      </div>
    </ActionForm>
  );

  return (
    <>
      <PageTitle
        back={{ href: "/staff/admin", label: "Settings" }}
        title="Optional extras"
        description="What a family can order alongside a place: stationery, transport, lunch, aftercare. Priced per campus, because the currency is the campus's — the same item costs pula in Gaborone and rand in Potchefstroom, so it is two rows."
      />
      <div className="space-y-3">
        {(items ?? []).map((i) => (
          <div key={i.id} className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {Array.isArray(i.campuses) ? i.campuses[0]?.name : i.campuses?.name} ·{" "}
              <span className="font-medium text-foreground">{formatMoney(i.amount_minor, i.currency)}</span>
              {i.is_active ? "" : " · switched off"}
            </p>
            {form(i)}
          </div>
        ))}
        <h2 className="pt-2 text-sm font-semibold">Add an extra</h2>
        {form(null)}
      </div>
    </>
  );
}
