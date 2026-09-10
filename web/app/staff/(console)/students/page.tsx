import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_TONE, studentName } from "@/lib/students/labels";
import { requireStaff } from "@/lib/staff/session";
import type { StudentStatus } from "@/lib/supabase/types";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The register: every child the school has, after the funnel let go of them.
 *
 * Read through the caller's own client, so campus scoping is the database's
 * answer and not this page's. A student's campus is a column on their own
 * row — kept in step with their newest live enrolment — because a child
 * outlives the application that admitted them.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ campus?: string; status?: string; q?: string }>;
}) {
  const { supabase } = await requireStaff("students.read");
  const params = await searchParams;

  const [{ data: campuses }, { data: families }] = await Promise.all([
    supabase.from("v_accessible_campuses").select("id, name").order("name"),
    supabase.from("families").select("id, family_code"),
  ]);

  let query = supabase
    .from("students")
    .select(
      "id, student_code, legal_first_name, legal_last_name, preferred_name, date_of_birth, status, family_id, details_confirmed_at, campuses!students_current_campus_id_fkey(name), grades!students_current_grade_id_fkey(name, sort_order)"
    )
    .order("legal_last_name")
    .order("legal_first_name");
  if (params.campus) query = query.eq("current_campus_id", params.campus);
  const status = params.status && params.status in STUDENT_STATUS_LABELS ? (params.status as StudentStatus) : null;
  if (status) query = query.eq("status", status);
  if (params.q) {
    const term = params.q.replace(/[%,()]/g, " ").trim();
    if (term) {
      query = query.or(
        `legal_first_name.ilike.%${term}%,legal_last_name.ilike.%${term}%,preferred_name.ilike.%${term}%,student_code.ilike.%${term}%`
      );
    }
  }
  const { data: students } = await query;

  const codeFor = new Map((families ?? []).map((f) => [f.id, f.family_code]));
  const rows = students ?? [];

  return (
    <>
      <PageTitle
        title="Students"
        description="Every child enrolled, and where they are now. A student stays here after their application is finished with."
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Name or student code"
            className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Campus</span>
          <select name="campus" defaultValue={params.campus ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="">Every campus</option>
            {(campuses ?? []).map((c) => (
              <option key={c.id} value={c.id!}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Status</span>
          <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="">Any status</option>
            {Object.entries(STUDENT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">Apply</button>
      </form>

      {rows.length ? (
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Student</th>
                <th className="px-3 py-2 font-medium">Campus</th>
                <th className="px-3 py-2 font-medium">Grade</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Family</th>
                <th className="px-3 py-2 font-medium">Details confirmed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">
                    <Link href={`/staff/students/${s.id}`} className="font-medium hover:underline">
                      {studentName(s)}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {s.student_code} · born {formatDate(s.date_of_birth)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{one(s.campuses)?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{one(s.grades)?.name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant={STUDENT_STATUS_TONE[s.status as StudentStatus]}>
                      {STUDENT_STATUS_LABELS[s.status as StudentStatus]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">{codeFor.get(s.family_id) ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.details_confirmed_at ? (
                      formatDate(s.details_confirmed_at)
                    ) : (
                      <span className="text-muted-foreground">never</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          No students yet. A child appears here the moment their enrolment is confirmed.
        </EmptyState>
      )}
    </>
  );
}
