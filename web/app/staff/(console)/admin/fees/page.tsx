import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireStaff } from "@/lib/staff/session";
import { Textarea } from "@/components/ui/textarea";
import { createSchedule, deleteSchedule, saveBankInstructions, saveSchedule } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function FeesPage() {
  const { supabase } = await requireStaff("finance.write");
  const [{ data: schedules }, { data: campuses }, { data: years }, { data: grades }, { data: bank }] = await Promise.all([
    supabase.from("fee_schedules").select("*, campuses(name), academic_years(label), fee_lines(*)").order("status", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("campuses").select("id, name, currency").order("sort_order"),
    supabase.from("academic_years").select("id, label").order("starts_on", { ascending: false }),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("bank_instructions").select("*").order("currency"),
  ]);
  const bankFor = (currency: "BWP" | "ZAR") => (bank ?? []).find((b) => b.currency === currency && b.campus_id === null && b.is_active) ?? null;
  const gradeName = (sort: number | null) => (sort === null ? "any" : grades?.find((g) => g.sort_order === sort)?.name ?? String(sort));

  return (
    <>
      <PageTitle
        title="Fees"
        description="What an offer shows and what a parent pays to secure a place. A schedule applies to a campus and academic year, optionally to a band of grades; the narrowest active match is used. Amounts are in the campus's currency."
      />
      <ActionForm action={createSchedule} label="Create schedule" size="sm" className="mb-5 grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-5">
        <Input name="name" placeholder="Name, e.g. Block 7 primary 2027" required className="md:col-span-2" />
        <NativeSelect name="campusId" required>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}</NativeSelect>
        <NativeSelect name="academicYearId" required>{(years ?? []).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</NativeSelect>
        <div className="grid grid-cols-2 gap-2">
          <NativeSelect name="gradeSortMin" defaultValue=""><option value="">Any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
          <NativeSelect name="gradeSortMax" defaultValue=""><option value="">to any</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
        </div>
      </ActionForm>

      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Bank transfer details</h2>
        <p className="mb-3 text-xs text-muted-foreground">Shown to parents who pay by transfer, on the payment page and in the payment emails, with their reference. One per currency; leave blank to offer online payment only.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {(["BWP", "ZAR"] as const).map((currency) => (
            <ActionForm key={currency} action={saveBankInstructions} label={`Save ${currency} details`} size="sm" variant="outline" className="space-y-2">
              <input type="hidden" name="currency" value={currency} />
              <Textarea name="bodyText" rows={5} defaultValue={bankFor(currency)?.body_text ?? ""} placeholder={`Account name\nBank\nAccount number\nBranch code\n(${currency})`} className="font-mono text-xs" />
            </ActionForm>
          ))}
        </div>
      </section>

      {schedules?.length ? (
        <div className="space-y-4">
          {schedules.map((s) => {
            const lines = [...(s.fee_lines ?? [])].sort((a, b) => a.position - b.position);
            return (
              <ActionForm key={s.id} action={saveSchedule} label="Save" size="sm" variant="outline" className="rounded-xl border border-border bg-card p-4">
                <input type="hidden" name="scheduleId" value={s.id} />
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{one(s.campuses)?.name} · {one(s.academic_years)?.label} · grades {gradeName(s.grade_sort_min)} – {gradeName(s.grade_sort_max)} · {s.currency}</p>
                  </div>
                  <Badge variant={s.status === "active" ? "success" : "outline"}>{s.status}</Badge>
                  <NativeSelect name="status" defaultValue={s.status} className="h-8 w-28 md:h-8"><option value="draft">Draft</option><option value="active">Active</option></NativeSelect>
                </div>
                <div className="grid gap-2">
                  <div className="grid grid-cols-[1fr_140px_150px] gap-2 text-xs text-muted-foreground"><span>Line</span><span>Amount ({s.currency})</span><span>Payable on acceptance</span></div>
                  {lines.map((l) => (
                    <div key={l.code} className="grid grid-cols-[1fr_140px_150px] items-center gap-2">
                      <Input name={`label_${l.code}`} defaultValue={l.label} className="h-8 md:h-8" />
                      <Input name={`amount_${l.code}`} defaultValue={(Number(l.amount_minor) / 100).toFixed(2)} inputMode="decimal" className="h-8 text-right tabular-nums md:h-8" />
                      <label className="text-xs"><input type="checkbox" name={`payable_${l.code}`} value="1" defaultChecked={l.payable_at_acceptance} /> yes</label>
                    </div>
                  ))}
                </div>
                {s.status === "draft" ? (
                  <p className="mt-2 text-xs text-muted-foreground">A draft is never used for an offer.</p>
                ) : null}
              </ActionForm>
            );
          })}
          {schedules.filter((s) => s.status === "draft").map((s) => (
            <ActionForm key={`del-${s.id}`} action={deleteSchedule} label={`Delete draft "${s.name}"`} size="xs" variant="ghost" confirm="Delete this draft schedule?">
              <input type="hidden" name="scheduleId" value={s.id} />
            </ActionForm>
          ))}
        </div>
      ) : (
        <EmptyState>No fee schedules. An approved applicant&apos;s offer waits here until one is active for their campus, grade and year.</EmptyState>
      )}
    </>
  );
}
