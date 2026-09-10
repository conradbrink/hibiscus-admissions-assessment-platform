import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { availableCodes, feeDefaults, scheduleTotals } from "@/lib/fees/codes";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";
import { Textarea } from "@/components/ui/textarea";
import { createSchedule, deleteSchedule, saveBankInstructions, saveSchedule } from "./actions";

/**
 * What an offer shows and what a parent pays to secure a place.
 *
 * Two things about the shape of this page, because both were got wrong once.
 * A *schedule* is a scope — a campus, a year, a band of grades — and the fees
 * hang off it as lines. The create form asks for a scope, not a fee, and now
 * says so: it did not, and somebody typed "Admission fee" into it.
 *
 * And it is filtered. Six campuses across two academic years is fifty
 * schedules, twenty-five of them for a year nobody is working on yet;
 * rendering every one made the list something to search rather than read, and
 * pushed it below the bank details entirely.
 */
export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{ campus?: string; year?: string }>;
}) {
  const { supabase } = await requireStaff("finance.write");
  const sp = await searchParams;

  const [{ data: campuses }, { data: years }, { data: grades }, { data: bank }] = await Promise.all([
    supabase.from("campuses").select("id, name, currency").eq("is_active", true).order("sort_order"),
    supabase.from("academic_years").select("id, label, is_current, starts_on").order("starts_on", { ascending: false }),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("bank_instructions").select("*").order("currency"),
  ]);

  // The same three-step fallback the forecast page uses, so the two agree on
  // which year is "now": what was asked for, else the year flagged current,
  // else the most recent.
  const yearFilter =
    sp.year === "all"
      ? null
      : (years ?? []).find((y) => y.id === sp.year) ?? (years ?? []).find((y) => y.is_current) ?? years?.[0] ?? null;

  let query = supabase
    .from("fee_schedules")
    .select("*, fee_lines(*)")
    .order("status", { ascending: false })
    .order("created_at", { ascending: false });
  if (sp.campus) query = query.eq("campus_id", sp.campus);
  if (yearFilter) query = query.eq("academic_year_id", yearFilter.id);
  const { data: schedules } = await query;

  const bankFor = (currency: "BWP" | "ZAR", campusId: string | null) =>
    (bank ?? []).find((b) => b.currency === currency && b.campus_id === campusId && b.is_active) ?? null;

  const rows = schedules ?? [];
  const emptyActive = rows.filter((s) => s.status === "active" && (s.fee_lines ?? []).length === 0).length;

  return (
    <>
      <PageTitle
        back={{ href: "/staff/admin", label: "Settings" }}
        title="Fees"
        description="A schedule is a scope — one campus, one academic year, optionally a band of grades — and the fees sit on it. When an offer is generated, the narrowest active schedule covering that child wins. Amounts are in the campus's currency."
      />

      {/* A plain GET form, so a filtered view can be bookmarked or sent to a colleague. */}
      <form className="mb-4 flex flex-wrap items-end gap-3 surface p-3">
        <div className="space-y-1">
          <Label htmlFor="campus" className="text-xs">Campus</Label>
          <NativeSelect id="campus" name="campus" defaultValue={sp.campus ?? ""} className="h-9 w-48">
            <option value="">Every campus</option>
            {(campuses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="year" className="text-xs">Academic year</Label>
          <NativeSelect id="year" name="year" defaultValue={sp.year ?? yearFilter?.id ?? "all"} className="h-9 w-44">
            {(years ?? []).map((y) => (
              <option key={y.id} value={y.id}>{y.label}{y.is_current ? " (current)" : ""}</option>
            ))}
            <option value="all">Every year</option>
          </NativeSelect>
        </div>
        <Button type="submit" size="sm" variant="outline">Show</Button>
        <p className="ml-auto text-xs text-muted-foreground">
          {rows.length} schedule{rows.length === 1 ? "" : "s"}
          {emptyActive > 0 ? ` · ${emptyActive} active with no fees` : ""}
        </p>
      </form>

      <ActionForm action={createSchedule} label="Create schedule" size="sm" className="mb-5 grid gap-2 surface p-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <Input name="name" placeholder="Name the scope, e.g. Block 7 primary 2027" required maxLength={120} />
          <p className="mt-1 text-xs text-muted-foreground">Who it covers, not what it charges — the fees go on it afterwards.</p>
        </div>
        <NativeSelect name="campusId" required defaultValue={sp.campus ?? ""}>
          {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
        </NativeSelect>
        <NativeSelect name="academicYearId" required defaultValue={yearFilter?.id ?? ""}>
          {(years ?? []).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        </NativeSelect>
        <div className="grid grid-cols-2 gap-2">
          <NativeSelect name="gradeSortMin" defaultValue=""><option value="">Any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
          <NativeSelect name="gradeSortMax" defaultValue=""><option value="">to any</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
        </div>
      </ActionForm>

      {rows.length ? (
        <div className="space-y-4">
          {rows.map((s) => {
            const lines = [...(s.fee_lines ?? [])].sort((a, b) => a.position - b.position);
            const used = lines.map((l) => l.code);
            const canAdd = availableCodes(used);
            const totals = scheduleTotals(lines);
            const currency = s.currency as "BWP" | "ZAR";
            return (
              <div key={s.id} className="surface p-4">
                <ActionForm action={saveSchedule} label="Save" size="sm" variant="outline">
                  <input type="hidden" name="scheduleId" value={s.id} />
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <Input name="name" defaultValue={s.name} required maxLength={120} className="h-9 font-semibold md:h-9" />
                    </div>
                    <Badge variant={s.status === "active" ? "success" : "outline"}>{s.status}</Badge>
                    <NativeSelect name="status" defaultValue={s.status} className="h-8 w-28 md:h-8">
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                    </NativeSelect>
                  </div>

                  {/* Who this schedule covers. Changing it decides which schedule wins
                      the next offer; one already sent keeps the fees it was sent with. */}
                  <div className="mb-3 grid gap-2 md:grid-cols-4">
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Campus</span>
                      <NativeSelect name="campusId" defaultValue={s.campus_id} required className="h-8 md:h-8">
                        {(campuses ?? []).map((c) => (
                          <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Academic year</span>
                      <NativeSelect name="academicYearId" defaultValue={s.academic_year_id} required className="h-8 md:h-8">
                        {(years ?? []).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
                      </NativeSelect>
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">From grade</span>
                      <NativeSelect name="gradeSortMin" defaultValue={s.grade_sort_min ?? ""} className="h-8 md:h-8">
                        <option value="">Any grade</option>
                        {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>{g.name}</option>)}
                      </NativeSelect>
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">To grade</span>
                      <NativeSelect name="gradeSortMax" defaultValue={s.grade_sort_max ?? ""} className="h-8 md:h-8">
                        <option value="">to any</option>
                        {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>{g.name}</option>)}
                      </NativeSelect>
                    </label>
                  </div>
                  <label className="mb-3 flex items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" name="allowCurrencyChange" value="1" className="mt-0.5 size-3.5" />
                    <span>
                      Let this change the currency. Only needed to move the schedule to a campus that
                      bills in the other currency — the amounts stay as typed, so {formatMoney(30000, currency)}{" "}
                      would become the same number in the new one. Ignored otherwise.
                    </span>
                  </label>

                  {s.status === "active" && lines.length === 0 ? (
                    <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                      Active, with no fees on it. An offer for a child this covers would quote nothing at all. Add a
                      fee, or set it back to draft.
                    </p>
                  ) : null}

                  <div className="grid gap-2">
                    <div className="grid grid-cols-[1fr_140px_150px_80px] gap-2 text-xs text-muted-foreground">
                      <span>Fee</span><span>Amount ({currency})</span><span>Payable on acceptance</span><span>Remove</span>
                    </div>
                    {lines.map((l) => (
                      <div key={l.code} className="grid grid-cols-[1fr_140px_150px_80px] items-center gap-2">
                        <input type="hidden" name="lineCode" value={l.code} />
                        <Input name={`label_${l.code}`} defaultValue={l.label} maxLength={120} className="h-8 md:h-8" />
                        <Input name={`amount_${l.code}`} defaultValue={(Number(l.amount_minor) / 100).toFixed(2)} inputMode="decimal" className="h-8 text-right tabular-nums md:h-8" />
                        <label className="text-xs"><input type="checkbox" name={`payable_${l.code}`} value="1" defaultChecked={l.payable_at_acceptance} /> yes</label>
                        <label className="text-xs"><input type="checkbox" name={`remove_${l.code}`} value="1" /> remove</label>
                      </div>
                    ))}
                    {lines.length === 0 ? <p className="text-xs text-muted-foreground">No fees on this schedule yet.</p> : null}
                  </div>

                  {canAdd.length ? (
                    <div className="mt-3 border-t border-border/60 pt-3">
                      <p className="mb-2 text-xs text-muted-foreground">Add a fee. One per save, and each kind can appear once.</p>
                      <div className="grid grid-cols-[1fr_140px_150px_80px] items-center gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          <NativeSelect name="newCode" defaultValue="" className="h-8 md:h-8">
                            <option value="">Add nothing</option>
                            {canAdd.map((c) => <option key={c} value={c}>{feeDefaults(c).label}</option>)}
                          </NativeSelect>
                          <Input name="newLabel" placeholder="Or call it something else" maxLength={120} className="h-8 md:h-8" />
                        </div>
                        <Input name="newAmount" placeholder="0.00" inputMode="decimal" className="h-8 text-right tabular-nums md:h-8" />
                        <label className="text-xs"><input type="checkbox" name="newPayable" value="1" /> yes</label>
                        <span />
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-baseline gap-4 text-xs text-muted-foreground">
                    <span>
                      Everything on this schedule <span className="font-medium tabular-nums text-foreground">{formatMoney(totals.total, currency)}</span>
                    </span>
                    <span>
                      Due to accept the place <span className="font-medium tabular-nums text-foreground">{formatMoney(totals.atAcceptance, currency)}</span>
                    </span>
                  </div>

                  {s.status === "draft" ? <p className="mt-2 text-xs text-muted-foreground">A draft is never used for an offer.</p> : null}
                </ActionForm>

                {s.status === "draft" ? (
                  <ActionForm action={deleteSchedule} label="Delete this draft" size="xs" variant="ghost" confirm={`Delete the draft "${s.name}"?`} className="mt-2">
                    <input type="hidden" name="scheduleId" value={s.id} />
                  </ActionForm>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState>
          No fee schedules for this campus and year. An approved applicant&apos;s offer waits until one is active for
          their campus, grade and year.
        </EmptyState>
      )}

      <details className="mt-6 surface p-4">
        <summary className="cursor-pointer text-sm font-semibold">Bank transfer details</summary>
        <p className="mb-3 mt-2 text-xs text-muted-foreground">Shown to parents who pay by transfer: in the offer letter, on the payment page and in the payment emails, with their reference. Each campus can have its own account. A campus with no details of its own uses the default for its currency. Leave everything blank to offer online payment only.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {(["BWP", "ZAR"] as const).map((currency) => (
            <ActionForm key={currency} action={saveBankInstructions} label={`Save ${currency} default`} size="sm" variant="outline" className="space-y-2">
              <input type="hidden" name="currency" value={currency} />
              <p className="text-xs font-medium">Default for {currency}</p>
              <Textarea name="bodyText" rows={5} defaultValue={bankFor(currency, null)?.body_text ?? ""} placeholder={`Bank\nAccount name\nAccount number\nBranch code`} className="font-mono text-xs" />
            </ActionForm>
          ))}
          {(campuses ?? []).map((c) => (
            <ActionForm key={c.id} action={saveBankInstructions} label={`Save ${c.name}`} size="sm" variant="outline" className="space-y-2">
              <input type="hidden" name="currency" value={c.currency} />
              <input type="hidden" name="campusId" value={c.id} />
              <p className="text-xs font-medium">{c.name} ({c.currency})</p>
              <Textarea name="bodyText" rows={5} defaultValue={bankFor(c.currency as "BWP" | "ZAR", c.id)?.body_text ?? ""} placeholder={`Leave blank to use the ${c.currency} default`} className="font-mono text-xs" />
            </ActionForm>
          ))}
        </div>
      </details>
    </>
  );
}
