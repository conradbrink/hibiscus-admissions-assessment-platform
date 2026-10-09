import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Pill } from "@/components/staff/field";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/employees/labels";
import { formatDate } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { accessibleCampuses } from "@/lib/recruitment/campuses";
import { requireStaff } from "@/lib/staff/session";
import type { EmploymentStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; campus?: string; status?: string }> }) {
  const ctx = await requireStaff("hr.employees.read");
  const sp = await searchParams;
  const status = (["active", "on_leave", "suspended", "terminated", "all"] as const).find((s) => s === sp.status) ?? "current";
  let query = ctx.supabase.from("hr_employees").select("*").order("last_name").order("first_name").limit(500);
  if (sp.campus) query = query.eq("campus_id", sp.campus);
  if (status === "current") query = query.neq("employment_status", "terminated");
  else if (status !== "all") query = query.eq("employment_status", status);
  const q = (sp.q ?? "").trim();
  if (q) {
    const like = `%${q.replace(/[%_,()]/g, " ")}%`;
    query = query.or(`first_name.ilike.${like},last_name.ilike.${like},employee_number.ilike.${like},position_title.ilike.${like}`);
  }
  const [{ data: employees }, campuses, { data: departments }] = await Promise.all([
    query,
    accessibleCampuses(ctx.supabase),
    ctx.supabase.from("hr_departments").select("id, name"),
  ]);
  const campusName = new Map(campuses.map((c) => [c.id, c.name]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  return (
    <>
      <PageTitle title="Employees" description="Everyone who works at the schools. Open a person to see their contract, pay, leave and records.">
        {can(ctx.permissions, "hr.employees.write") ? (
          <Link href="/staff/employees/new" className={cn(buttonVariants({ size: "lg" }))}>
            <Plus aria-hidden /> Add employee
          </Link>
        ) : null}
      </PageTitle>

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search by name, number or position" aria-label="Search employees" className="pl-9" />
        </div>
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} aria-label="School">
          <option value="">Every school</option>
          {campuses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={status} aria-label="Status">
          <option value="current">Current staff</option>
          <option value="active">Working</option>
          <option value="on_leave">On leave</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Left</option>
          <option value="all">Everyone</option>
        </NativeSelect>
        <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Show</button>
      </form>

      {employees?.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Position</th>
                <th>School</th>
                <th>Started</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/staff/employees/${e.id}`} className="font-semibold hover:text-primary hover:underline">
                      {e.first_name} {e.last_name}
                    </Link>
                    <span className="block text-xs text-muted-foreground tabular-nums">{e.employee_number}</span>
                  </td>
                  <td>
                    {e.position_title}
                    {e.department_id ? <span className="block text-xs text-muted-foreground">{deptName.get(e.department_id)}</span> : null}
                  </td>
                  <td>{campusName.get(e.campus_id) ?? ""}</td>
                  <td className="tabular-nums">{formatDate(e.start_date)}</td>
                  <td>
                    <Pill tone={STATUS_TONE[e.employment_status as EmploymentStatus]}>{STATUS_LABEL[e.employment_status as EmploymentStatus]}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          {q || sp.campus || sp.status ? "Nobody matches. Try a different search." : "No employees yet. Add someone, or hire a shortlisted applicant from the pipeline."}
        </EmptyState>
      )}
    </>
  );
}
