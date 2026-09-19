import Link from "next/link";
import { CampusPicker } from "@/components/crm/campus-picker";
import { Pagination, queryBuilder } from "@/components/crm/bits";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_TONE, studentName } from "@/lib/students/labels";
import type { StudentStatus } from "@/lib/supabase/types";

const PAGE = 50;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The register, as the CRM sees it: each child with their family, their
 * activities from the catalogue and their open opportunities. The rows are
 * the same `students` rows the admissions register shows; the child's own
 * page is the register's.
 */
export default async function CrmStudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; campus?: string; grade?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("students.read");
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  let q = supabase
    .from("students")
    .select("id, student_code, legal_first_name, legal_last_name, preferred_name, date_of_birth, status, family_id, created_at, campuses!students_current_campus_id_fkey(name), grades!students_current_grade_id_fkey(name), families!students_family_id_fkey(display_name, family_code)", { count: "exact" })
    .order("legal_last_name")
    .order("legal_first_name")
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.campus) q = q.eq("current_campus_id", sp.campus);
  if (sp.grade) q = q.eq("current_grade_id", sp.grade);
  if (sp.status && sp.status in STUDENT_STATUS_LABELS) q = q.eq("status", sp.status as StudentStatus);
  if (sp.q?.trim()) {
    const term = sp.q.trim().replace(/[%,()]/g, " ").trim();
    q = q.or(`legal_first_name.ilike.%${term}%,legal_last_name.ilike.%${term}%,preferred_name.ilike.%${term}%,student_code.ilike.%${term}%`);
  }
  const [{ data: rows, count }, { data: campuses }, { data: grades }] = await Promise.all([
    q,
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("grades").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  const ids = (rows ?? []).map((r) => r.id);
  const [{ data: selections }, { data: opps }, { data: enrolments }] = ids.length
    ? await Promise.all([
        supabase.from("student_optional_selections").select("student_id, optional_items(label)").in("student_id", ids).in("status", ["selected", "paid"]),
        supabase.from("opportunities").select("student_id, opportunity_types(name)").in("student_id", ids).in("status", ["identified", "contacted", "interested"]),
        supabase.from("enrolments").select("student_id, starts_on, class_groups(name)").in("student_id", ids).in("status", ["pending", "active"]),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const activitiesOf = new Map<string, string[]>();
  for (const s of selections ?? []) activitiesOf.set(s.student_id, [...(activitiesOf.get(s.student_id) ?? []), one(s.optional_items)?.label ?? ""]);
  const oppsOf = new Map<string, string[]>();
  for (const o of opps ?? []) if (o.student_id) oppsOf.set(o.student_id, [...(oppsOf.get(o.student_id) ?? []), one(o.opportunity_types)?.name ?? ""]);
  const enrolOf = new Map<string, { starts_on: string | null; className: string | null }>();
  for (const e of enrolments ?? []) enrolOf.set(e.student_id, { starts_on: e.starts_on, className: one(e.class_groups)?.name ?? null });
  const qs = queryBuilder(sp);

  return (
    <>
      <PageTitle title="Students" description={`${count ?? 0} on the register. A child's own page is in Admissions → Students.`}>
        <CampusPicker campuses={campuses ?? []} current={sp.campus ?? null} />
      </PageTitle>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {sp.campus ? <input type="hidden" name="campus" value={sp.campus} /> : null}
        <Input name="q" placeholder="Name or student code" defaultValue={sp.q ?? ""} className="w-56" />
        <NativeSelect name="grade" defaultValue={sp.grade ?? ""} className="w-40" aria-label="Grade"><option value="">Any grade</option>{(grades ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect>
        <NativeSelect name="status" defaultValue={sp.status ?? ""} className="w-40" aria-label="Status"><option value="">Any status</option>{Object.entries(STUDENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
        <Button type="submit" size="lg" variant="secondary">Filter</Button>
      </form>
      {rows?.length ? (
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead><tr><th>Student</th><th>Family</th><th>Campus</th><th>Grade</th><th>Class</th><th>Status</th><th>Admitted</th><th>Activities</th><th>Opportunities</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const fam = one(s.families);
                const en = enrolOf.get(s.id);
                return (
                  <tr key={s.id}>
                    <td><Link href={`/staff/students/${s.id}`} className="font-medium hover:underline">{studentName(s)}</Link><span className="block text-xs text-muted-foreground">{s.student_code} · born {formatDate(s.date_of_birth)}</span></td>
                    <td className="text-xs"><Link href={`/staff/crm/families/${s.family_id}`} className="hover:underline">{fam?.display_name ?? fam?.family_code}</Link></td>
                    <td className="text-xs">{one(s.campuses)?.name ?? "—"}</td>
                    <td className="text-xs">{one(s.grades)?.name ?? "—"}</td>
                    <td className="text-xs">{en?.className ?? <span className="text-muted-foreground">—</span>}</td>
                    <td><Badge variant={STUDENT_STATUS_TONE[s.status as StudentStatus]}>{STUDENT_STATUS_LABELS[s.status as StudentStatus]}</Badge></td>
                    <td className="text-xs">{en?.starts_on ? formatDate(en.starts_on) : formatDate(s.created_at)}</td>
                    <td className="text-xs">{activitiesOf.get(s.id)?.join(", ") || <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-xs">{oppsOf.get(s.id)?.join(", ") || <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState>No students match.</EmptyState>}
      <Pagination page={page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} qs={qs} />
    </>
  );
}
