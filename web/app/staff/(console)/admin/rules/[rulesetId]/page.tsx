import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireStaff } from "@/lib/staff/session";
import { activateRuleset, addRule, deleteRule, deleteRuleset, saveRuleset } from "../actions";

export default async function RulesetPage({ params }: { params: Promise<{ rulesetId: string }> }) {
  const { rulesetId } = await params;
  const { supabase } = await requireStaff("rules.write");
  const [{ data: ruleset }, { data: rules }, { data: subjects }, { data: competencies }, { data: grades }, { data: campuses }] = await Promise.all([
    supabase.from("admission_rulesets").select("*").eq("id", rulesetId).maybeSingle(),
    supabase.from("admission_rules").select("*").eq("ruleset_id", rulesetId).order("position"),
    supabase.from("subjects").select("id, name").order("sort_order"),
    supabase.from("competencies").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  if (!ruleset) notFound();
  const draft = ruleset.status === "draft";
  const scopeName = (scope: string, id: string | null) =>
    scope === "overall" ? "Overall" : scope === "subject" ? subjects?.find((s) => s.id === id)?.name ?? "?" : competencies?.find((c) => c.id === id)?.name ?? "?";
  const hidden = <input type="hidden" name="rulesetId" value={ruleset.id} />;

  return (
    <>
      <PageTitle title={ruleset.name} description={ruleset.description ?? `Version ${ruleset.version}`}>
        <Badge variant={ruleset.status === "active" ? "success" : ruleset.status === "superseded" ? "muted" : "outline"}>{ruleset.status}</Badge>
        {draft ? (
          <>
            <ActionForm action={activateRuleset} label="Activate" size="sm" variant="success" confirm="Activate this ruleset? It replaces the active one with the same scope and cannot be edited afterwards.">{hidden}</ActionForm>
            <ActionForm action={deleteRuleset} label="Delete draft" size="sm" variant="destructive" confirm="Delete this draft?">{hidden}</ActionForm>
          </>
        ) : null}
        <Link href="/staff/admin/rules" className="text-sm text-muted-foreground hover:underline">All rulesets</Link>
      </PageTitle>

      {!draft ? <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">This ruleset is frozen. Decisions made under it record its version. To change the rules, create a new draft and activate that.</p> : null}

      {draft ? (
        <ActionForm action={saveRuleset} label="Save" size="sm" variant="outline" className="mb-6 grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-5">
          {hidden}
          <Input name="name" defaultValue={ruleset.name} required className="md:col-span-2" />
          <NativeSelect name="gradeSortMin" defaultValue={ruleset.grade_sort_min ?? ""}><option value="">From any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
          <NativeSelect name="gradeSortMax" defaultValue={ruleset.grade_sort_max ?? ""}><option value="">To any grade</option>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
          <NativeSelect name="campusId" defaultValue={ruleset.campus_id ?? ""}><option value="">Every campus</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}</NativeSelect>
          <Input name="description" defaultValue={ruleset.description ?? ""} placeholder="Why these thresholds" className="md:col-span-5" />
        </ActionForm>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold">Rules, checked in order</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Rule</th><th className="px-3 py-2 font-medium">Scope</th><th className="px-3 py-2 font-medium">Condition</th><th className="px-3 py-2 font-medium">If not met</th><th className="px-3 py-2"></th></tr></thead>
          <tbody className="divide-y divide-border">
            {(rules ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2">{scopeName(r.scope, r.scope_id)}</td>
                <td className="px-3 py-2 font-mono">{r.operator} {r.threshold}%</td>
                <td className="px-3 py-2"><Badge variant={r.severity === "hard_fail" ? "destructive" : "warning"}>{r.severity === "hard_fail" ? "Decline" : "Refer to a person"}</Badge></td>
                <td className="px-3 py-2 text-right">
                  {draft ? <ActionForm action={deleteRule} label="Remove" size="xs" variant="ghost">{hidden}<input type="hidden" name="ruleId" value={r.id} /></ActionForm> : null}
                </td>
              </tr>
            ))}
            {!rules?.length ? <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No rules yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {draft ? (
        <ActionForm action={addRule} label="Add rule" size="sm" className="mt-4 grid gap-2 rounded-xl border border-dashed border-border p-3 md:grid-cols-6">
          {hidden}
          <NativeSelect name="scope" defaultValue="overall"><option value="overall">Overall</option><option value="subject">Subject</option><option value="competency">Competency</option></NativeSelect>
          <NativeSelect name="scopeId" defaultValue="">
            <option value="">— which —</option>
            {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>Subject: {s.name}</option>)}
            {(competencies ?? []).map((c) => <option key={c.id} value={c.id}>Competency: {c.name}</option>)}
          </NativeSelect>
          <NativeSelect name="operator" defaultValue=">="><option value=">=">at least (≥)</option><option value=">">more than (&gt;)</option><option value="<=">at most (≤)</option><option value="<">less than (&lt;)</option></NativeSelect>
          <Input name="threshold" type="number" step="0.5" min={0} max={100} placeholder="%" required />
          <NativeSelect name="severity" defaultValue="review"><option value="review">If not met: refer to a person</option><option value="hard_fail">If not met: decline</option></NativeSelect>
          <Input name="label" placeholder="Label, e.g. Overall at least 50%" required />
        </ActionForm>
      ) : null}
    </>
  );
}
