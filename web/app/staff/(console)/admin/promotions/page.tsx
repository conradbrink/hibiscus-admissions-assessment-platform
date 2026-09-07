import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format-date";
import { HEARD_FROM_OPTIONS } from "@/lib/heard-from";
import { requireStaff } from "@/lib/staff/session";
import type { PromotionEffectRow, PromotionRow } from "@/lib/supabase/types";
import { deletePromotion, savePromotion } from "./actions";

type Lists = {
  campuses: Array<{ id: string; name: string }>;
  years: Array<{ id: string; label: string }>;
  grades: Array<{ name: string; sort_order: number }>;
};

/** One promotion's form: the same fields for a new deal and an existing one. */
function PromotionForm({ promo, effects, lists, redemptions }: { promo: PromotionRow | null; effects: PromotionEffectRow[]; lists: Lists; redemptions: number }) {
  const waived = (code: string) => effects.some((e) => e.kind === "waive_fee" && e.fee_code === code);
  const discount = effects.find((e) => (e.kind === "discount_fixed" || e.kind === "discount_percent") && e.fee_code === "admission");
  const gifts = effects.filter((e) => e.kind === "gift").map((e) => e.label).join("\n");
  const discountValue = discount ? (discount.kind === "discount_fixed" ? (Number(discount.amount_minor) / 100).toFixed(2) : String(Number(discount.percent))) : "";
  const cap = promo?.max_redemptions;
  return (
    <ActionForm action={savePromotion} label={promo ? "Save" : "Create promotion"} size="sm" variant={promo ? "outline" : "default"} className="surface space-y-4 p-4">
      {promo ? <input type="hidden" name="promotionId" value={promo.id} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          {promo ? (
            <p className="font-semibold">{promo.name}{promo.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{promo.code}</span> : null}</p>
          ) : (
            <p className="font-semibold">New promotion</p>
          )}
          {promo ? (
            <p className="text-xs text-muted-foreground">
              Used {redemptions} time{redemptions === 1 ? "" : "s"}{cap ? ` of ${cap}` : ""} · created {formatDate(promo.created_at)}
            </p>
          ) : null}
        </div>
        {promo ? <Badge variant={promo.is_active ? "success" : "outline"}>{promo.is_active ? "live" : "off"}</Badge> : null}
        <label className="text-xs"><input type="checkbox" name="isActive" value="1" defaultChecked={promo?.is_active ?? false} /> switched on</label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-xs md:col-span-2">
          <span className="font-medium">Name (parents see this on the letter)</span>
          <Input name="name" defaultValue={promo?.name ?? ""} placeholder="Launch 2027" required maxLength={80} className="h-8 md:h-8" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium">Code (optional)</span>
          <Input name="code" defaultValue={promo?.code ?? ""} placeholder="LAUNCH2027" maxLength={24} className="h-8 font-mono uppercase md:h-8" />
          <span className="block text-muted-foreground">With a code, the parent types it at enquiry. Without one, the deal applies by the rules below.</span>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase text-muted-foreground">What the parent gets</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label><input type="checkbox" name="waiveRegistration" value="1" defaultChecked={waived("registration")} /> Waive the application fee</label>
          <label><input type="checkbox" name="waiveAdmission" value="1" defaultChecked={waived("admission")} /> Waive the admission fee</label>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium">Admission fee discount (if not waived)</span>
            <NativeSelect name="admissionDiscountKind" defaultValue={discount ? (discount.kind === "discount_fixed" ? "fixed" : "percent") : "none"} className="h-8 md:h-8">
              <option value="none">None</option>
              <option value="fixed">An amount off</option>
              <option value="percent">A percentage off</option>
            </NativeSelect>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">Amount or percentage</span>
            <Input name="admissionDiscountValue" defaultValue={discountValue} placeholder="500 or 10" inputMode="decimal" className="h-8 md:h-8" />
          </label>
        </div>
        <label className="block space-y-1 text-xs">
          <span className="font-medium">Gifts, one per line (as the parent will read them)</span>
          <Textarea name="gifts" rows={3} defaultValue={gifts} placeholder={"P1,000 uniform voucher\nHibiscus hat and T-shirt"} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="font-medium">A sentence for the letter (optional)</span>
          <Input name="letterText" defaultValue={promo?.letter_text ?? ""} maxLength={400} placeholder="Collect your voucher from the campus office on your first day." className="h-8 md:h-8" />
        </label>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase text-muted-foreground">Who qualifies (leave blank for everyone)</legend>
        <div className="grid gap-2 md:grid-cols-4">
          <NativeSelect name="campusId" defaultValue={promo?.campus_id ?? ""} className="h-8 md:h-8"><option value="">Any campus</option>{lists.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          <NativeSelect name="academicYearId" defaultValue={promo?.academic_year_id ?? ""} className="h-8 md:h-8"><option value="">Any academic year</option>{lists.years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</NativeSelect>
          <NativeSelect name="gradeSortMin" defaultValue={promo?.grade_sort_min ?? ""} className="h-8 md:h-8"><option value="">From any grade</option>{lists.grades.map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
          <NativeSelect name="gradeSortMax" defaultValue={promo?.grade_sort_max ?? ""} className="h-8 md:h-8"><option value="">To any grade</option>{lists.grades.map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
          <NativeSelect name="entryRoute" defaultValue={promo?.entry_route ?? ""} className="h-8 md:h-8"><option value="">Any entry route</option><option value="assessment">Booked an assessment</option><option value="visit">Booked a visit</option><option value="callback">Asked for a call</option></NativeSelect>
          <NativeSelect name="heardFrom" defaultValue={promo?.heard_from ?? ""} className="h-8 md:h-8"><option value="">Heard about us anywhere</option>{HEARD_FROM_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</NativeSelect>
          <label className="space-y-1 text-xs"><span className="font-medium">Runs from</span><Input type="date" name="startsOn" defaultValue={promo?.starts_on ?? ""} className="h-8 md:h-8" /></label>
          <label className="space-y-1 text-xs"><span className="font-medium">Until</span><Input type="date" name="endsOn" defaultValue={promo?.ends_on ?? ""} className="h-8 md:h-8" /></label>
          <label className="space-y-1 text-xs"><span className="font-medium">Limit to the first</span><Input type="number" name="maxRedemptions" min={1} defaultValue={cap ?? ""} placeholder="No limit" className="h-8 md:h-8" /></label>
        </div>
      </fieldset>
    </ActionForm>
  );
}

export default async function PromotionsPage() {
  const { supabase } = await requireStaff("settings.write");
  const [{ data: promotions }, { data: effects }, { data: used }, { data: campuses }, { data: years }, { data: grades }] = await Promise.all([
    supabase.from("promotions").select("*").order("is_active", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("promotion_effects").select("*").order("position"),
    supabase.from("application_promotions").select("promotion_id"),
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("academic_years").select("id, label").order("starts_on", { ascending: false }),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
  ]);
  const lists: Lists = { campuses: campuses ?? [], years: years ?? [], grades: grades ?? [] };
  const effectsFor = (id: string) => (effects ?? []).filter((e) => e.promotion_id === id);
  const redemptions = new Map<string, number>();
  for (const u of used ?? []) redemptions.set(u.promotion_id, (redemptions.get(u.promotion_id) ?? 0) + 1);

  return (
    <>
      <PageTitle back={{ href: "/staff/admin", label: "Settings" }}
        title="Promotions"
        description="Deals that change an offer: waived fees, a discount on the admission fee, and gifts. A deal with a code is typed by the parent at enquiry; a deal without one applies by its rules. Either way it is applied when the offer is drafted, shown on the letter, and staff can still change it before approval. A fully waived offer skips the payment step."
      />

      <div className="space-y-6">
        <PromotionForm promo={null} effects={[]} lists={lists} redemptions={0} />

        {promotions?.length ? (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Existing promotions ({promotions.length})</h2>
            {promotions.map((p) => (
              <div key={p.id} className="space-y-1">
                <PromotionForm promo={p} effects={effectsFor(p.id)} lists={lists} redemptions={redemptions.get(p.id) ?? 0} />
                {(redemptions.get(p.id) ?? 0) === 0 ? (
                  <ActionForm action={deletePromotion} label="Delete" size="xs" variant="ghost" confirm={`Delete "${p.name}"? It has not been used.`}>
                    <input type="hidden" name="promotionId" value={p.id} />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No promotions yet. Create one above; it stays off until you switch it on.</EmptyState>
        )}
      </div>
    </>
  );
}
