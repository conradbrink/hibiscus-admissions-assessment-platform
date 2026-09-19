"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RULE_FIELDS, RULE_OP_LABELS, ruleField, type Rule, type RuleOp } from "@/lib/crm/segments";

type Lookups = {
  campuses: Array<{ id: string; name: string }>;
  grades: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; full_name: string }>;
  opportunityTypes: Array<{ code: string; name: string }>;
  items: Array<{ code: string; label: string }>;
};

/**
 * "Campus is Block 7, and a child in Stage 5, and not registered for
 * robotics." One row per rule; the field decides which operators and
 * which value control are offered. The rules travel to the server as one
 * hidden JSON field, where `validateRules` refuses anything this builder
 * could not have produced.
 */
export function RuleBuilder({ initial, lookups, name = "rules" }: { initial: Rule[]; lookups: Lookups; name?: string }) {
  const [rules, setRules] = useState<Rule[]>(initial.length ? initial : [{ field: "lifecycle_stage", op: "eq", value: "active" }]);

  const update = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, ...patch };
      // A new field brings its own operators; the old value may not fit.
      if (patch.field) {
        const f = ruleField(patch.field);
        next.op = f?.ops[0] ?? "eq";
        next.value = f?.options?.[0]?.value ?? "";
      }
      if (patch.op && (patch.op === "in" || patch.op === "not_in") && !Array.isArray(next.value)) next.value = next.value ? [String(next.value)] : [];
      if (patch.op && patch.op !== "in" && patch.op !== "not_in" && Array.isArray(next.value)) next.value = next.value[0] ?? "";
      return next;
    }));

  const valueControl = (r: Rule, i: number) => {
    const f = ruleField(r.field);
    if (!f) return null;
    if (r.op === "is_true" || r.op === "is_false" || r.op === "is_null" || r.op === "is_not_null") return null;
    const multi = r.op === "in" || r.op === "not_in";
    const options =
      f.kind === "campus" ? lookups.campuses.map((c) => ({ value: c.id, label: c.name }))
      : f.kind === "grade" ? lookups.grades.map((g) => ({ value: g.id, label: g.name }))
      : f.kind === "staff" ? lookups.staff.map((s) => ({ value: s.id, label: s.full_name }))
      : f.kind === "opportunity_type" ? lookups.opportunityTypes.map((t) => ({ value: t.code, label: t.name }))
      : f.kind === "item" && lookups.items.length ? lookups.items.map((it) => ({ value: it.code, label: `${it.label} (${it.code})` }))
      : f.options ? [...f.options] : null;
    if (options && multi) {
      const chosen = Array.isArray(r.value) ? (r.value as string[]) : [];
      return (
        <span className="flex flex-wrap gap-1">
          {options.map((o) => (
            <label key={o.value} className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${chosen.includes(o.value) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
              <input type="checkbox" className="sr-only" checked={chosen.includes(o.value)} onChange={(e) => update(i, { value: e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value) })} />
              {o.label}
            </label>
          ))}
        </span>
      );
    }
    if (options) {
      return (
        <NativeSelect value={String(r.value ?? "")} onChange={(e) => update(i, { value: e.target.value })} className="w-52" aria-label="Value">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
      );
    }
    const numeric = f.kind === "number" || f.kind === "days" || r.op === "gte" || r.op === "lte";
    return <Input type={numeric ? "number" : "text"} value={String(r.value ?? "")} onChange={(e) => update(i, { value: numeric ? Number(e.target.value) : e.target.value })} className="w-40" aria-label="Value" placeholder={f.kind === "days" ? "days" : f.kind === "tag" ? "tag" : f.kind === "item" ? "catalogue code" : ""} />;
  };

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(rules)} />
      {rules.map((r, i) => {
        const f = ruleField(r.field);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-2">
            {i > 0 ? <span className="text-[11px] font-semibold text-muted-foreground uppercase">and</span> : null}
            <NativeSelect value={r.field} onChange={(e) => update(i, { field: e.target.value })} className="w-56" aria-label="Field">
              {RULE_FIELDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </NativeSelect>
            <NativeSelect value={r.op} onChange={(e) => update(i, { op: e.target.value as RuleOp })} className="w-44" aria-label="Operator">
              {(f?.ops ?? []).map((op) => <option key={op} value={op}>{RULE_OP_LABELS[op]}</option>)}
            </NativeSelect>
            {valueControl(r, i)}
            <Button type="button" variant="ghost" size="xs" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove rule">×</Button>
            {f?.hint ? <span className="w-full text-[11px] text-muted-foreground">{f.hint}</span> : null}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => setRules((rs) => [...rs, { field: "campus_id", op: "eq", value: lookups.campuses[0]?.id ?? "" }])}>Add a rule</Button>
    </div>
  );
}
