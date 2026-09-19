import "server-only";
import { convertedByCatalogue, familyQualifies, parseConditions, studentQualifies, type FamilyFacts, type StudentFacts } from "@/lib/crm/opportunities/rules";
import { gaboroneNow } from "@/lib/workflow/automation/rules";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * The opportunity engine: once a day, every active rule over every family.
 *
 * Gated by `crm_opportunity_engine_enabled` (off) and by `maintenance_runs`
 * so the five-minute drain runs it once per school day. Idempotent: the
 * unique index on open opportunities means a rule that fires twice creates
 * nothing twice, and a candidate that already has an open opportunity of
 * the type is left alone — including one a person is working.
 *
 * It also closes the loop the other way: an open activity opportunity
 * whose child now holds the catalogue item is marked registered, with the
 * item's price as the actual value, because the family took it up whether
 * or not anybody remembered to move the card.
 */
export type OpportunitySweep = { ran: boolean; created: number; converted: number; rules: number };

export async function sweepOpportunities(admin: AdminClient, now: Date = new Date()): Promise<OpportunitySweep> {
  const settings = await getSettings(admin);
  if (!settings.crmOpportunityEngineEnabled) return { ran: false, created: 0, converted: 0, rules: 0 };

  const key = `crm_opportunities:${gaboroneNow(now).date}`;
  const { data: already } = await admin.from("maintenance_runs").select("key").eq("key", key).maybeSingle();
  if (already) return { ran: false, created: 0, converted: 0, rules: 0 };
  await admin.from("maintenance_runs").upsert({ key, last_run_at: now.toISOString(), detail: {} });

  const { data: rules } = await admin.from("opportunity_rules").select("*").eq("is_active", true).order("sort_order");
  const sweep: OpportunitySweep = { ran: true, created: 0, converted: 0, rules: (rules ?? []).length };
  if (!rules?.length) {
    await convertFromCatalogue(admin, sweep);
    return sweep;
  }

  const [{ data: students }, { data: families }, { data: selections }, { data: open }] = await Promise.all([
    admin.from("students").select("id, family_id, current_campus_id, status, grades!students_current_grade_id_fkey(sort_order)").in("status", ["onboarding", "active", "on_leave"]),
    admin.from("v_crm_family_facts").select("family_id, campus_id, student_count, enrolled_count, reenrolment_outstanding, assigned_staff_id"),
    admin.from("student_optional_selections").select("student_id, optional_items(code)").in("status", ["selected", "paid"]),
    admin.from("opportunities").select("family_id, student_id, type_code").in("status", ["identified", "contacted", "interested"]),
  ]);

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const itemsByStudent = new Map<string, string[]>();
  for (const s of selections ?? []) {
    const code = one(s.optional_items)?.code;
    if (!code) continue;
    itemsByStudent.set(s.student_id, [...(itemsByStudent.get(s.student_id) ?? []), code]);
  }
  const openKeys = new Set((open ?? []).map((o) => `${o.family_id}:${o.student_id ?? o.family_id}:${o.type_code}`));
  const assigneeOf = new Map((families ?? []).map((f) => [f.family_id, f.assigned_staff_id]));

  const studentFacts: StudentFacts[] = (students ?? []).map((s) => ({
    id: s.id,
    family_id: s.family_id,
    campus_id: s.current_campus_id,
    status: s.status,
    grade_sort: one(s.grades)?.sort_order ?? null,
    registered_item_codes: itemsByStudent.get(s.id) ?? [],
  }));
  const familyFacts: FamilyFacts[] = (families ?? []).map((f) => ({
    id: f.family_id,
    campus_id: f.campus_id,
    student_count: f.student_count,
    enrolled_count: f.enrolled_count,
    reenrolment_outstanding: f.reenrolment_outstanding,
  }));
  const campusOf = new Map(familyFacts.map((f) => [f.id, f.campus_id]));

  for (const rule of rules) {
    const c = parseConditions(rule.conditions);
    let created = 0;
    const rows: Array<{ family_id: string; student_id: string | null; type_code: string; campus_id: string; rule_code: string; source: "rule"; estimated_value_minor: number | null; assigned_staff_id: string | null }> = [];
    if ((c.subject ?? "student") === "student") {
      for (const s of studentFacts) {
        if (!studentQualifies(c, s)) continue;
        const key = `${s.family_id}:${s.id}:${rule.type_code}`;
        if (openKeys.has(key)) continue;
        openKeys.add(key);
        rows.push({ family_id: s.family_id, student_id: s.id, type_code: rule.type_code, campus_id: s.campus_id, rule_code: rule.code, source: "rule", estimated_value_minor: rule.estimated_value_minor, assigned_staff_id: assigneeOf.get(s.family_id) ?? null });
      }
    } else {
      for (const f of familyFacts) {
        if (!familyQualifies(c, f) || !f.campus_id) continue;
        const key = `${f.id}:${f.id}:${rule.type_code}`;
        if (openKeys.has(key)) continue;
        openKeys.add(key);
        rows.push({ family_id: f.id, student_id: null, type_code: rule.type_code, campus_id: f.campus_id, rule_code: rule.code, source: "rule", estimated_value_minor: rule.estimated_value_minor, assigned_staff_id: assigneeOf.get(f.id) ?? null });
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error, count } = await admin.from("opportunities").insert(rows.slice(i, i + 200), { count: "exact" });
      if (error) {
        console.error("[opportunities] rule insert failed", { rule: rule.code, error: error.message });
        continue;
      }
      created += count ?? rows.slice(i, i + 200).length;
    }
    sweep.created += created;
    await admin.from("opportunity_rules").update({ last_run_at: now.toISOString(), last_run_created: created }).eq("code", rule.code);
  }

  void campusOf;
  await convertFromCatalogue(admin, sweep);
  return sweep;
}

/** An open opportunity whose child now holds the item: registered, with what they paid. */
async function convertFromCatalogue(admin: AdminClient, sweep: OpportunitySweep): Promise<void> {
  const { data: types } = await admin.from("opportunity_types").select("code, optional_item_code").not("optional_item_code", "is", null);
  if (!types?.length) return;
  const { data: open } = await admin
    .from("opportunities")
    .select("id, student_id, type_code, rule_code")
    .in("status", ["identified", "contacted", "interested"])
    .in("type_code", types.map((t) => t.code))
    .not("student_id", "is", null);
  if (!open?.length) return;
  const studentIds = [...new Set(open.map((o) => o.student_id!))];
  const held = new Map<string, Array<{ code: string; amount: number }>>();
  for (let i = 0; i < studentIds.length; i += 200) {
    const { data } = await admin
      .from("student_optional_selections")
      .select("student_id, unit_amount_minor, quantity, optional_items(code)")
      .in("student_id", studentIds.slice(i, i + 200))
      .in("status", ["selected", "paid"]);
    for (const s of data ?? []) {
      const code = (Array.isArray(s.optional_items) ? s.optional_items[0] : s.optional_items)?.code;
      if (!code) continue;
      held.set(s.student_id, [...(held.get(s.student_id) ?? []), { code, amount: s.unit_amount_minor * s.quantity }]);
    }
  }
  const itemFor = new Map(types.map((t) => [t.code, t.optional_item_code!]));
  for (const o of open) {
    const item = itemFor.get(o.type_code);
    const holds = held.get(o.student_id!) ?? [];
    if (!item || !convertedByCatalogue({ not_registered_item: item }, { registered_item_codes: holds.map((h) => h.code) })) continue;
    const amount = holds.filter((h) => h.code === item).reduce((n, h) => n + h.amount, 0);
    const { error } = await admin.from("opportunities").update({ status: "registered", actual_value_minor: amount || null }).eq("id", o.id);
    if (!error) sweep.converted += 1;
  }
}
