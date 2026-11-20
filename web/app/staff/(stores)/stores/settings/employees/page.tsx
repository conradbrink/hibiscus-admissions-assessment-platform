import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { EmployeeEditor } from "@/components/stores/settings-forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { listNamed, searchTerm } from "@/lib/stores/data";
import { cn } from "@/lib/utils";

export const metadata = { title: "Employees" };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The directory of people who collect stock. Not accounts: an employee never
 * signs in and is never sent anything. Somebody who has left is switched off,
 * so their signatures and history still name them.
 */
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("stores.write");
  const term = searchTerm(sp.q);
  let q = supabase.from("stores_employees").select("*, stores_departments!stores_employees_department_id_fkey(name)").order("full_name").limit(500);
  if (!sp.all) q = q.eq("is_active", true);
  if (term) q = q.or(`full_name.ilike.%${term}%,employee_number.ilike.%${term}%`);
  const [{ data, error }, departments, { data: campuses }] = await Promise.all([q, listNamed(supabase, "stores_departments"), supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order")]);
  if (error) throw new Error(error.message);
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Employees" description="The people who collect stock. They never sign in, and Stores never sends them anything." back={can(permissions, "stores.admin") ? { href: "/staff/stores/settings", label: "Settings" } : undefined} />
      <details className="surface mb-4 p-4" open={!data?.length && !term}>
        <summary className="cursor-pointer text-sm font-semibold">Add an employee</summary>
        <div className="mt-3"><EmployeeEditor departments={departments} campuses={campuses ?? []} /></div>
      </details>
      <form method="get" role="search" className="mb-3 flex flex-wrap gap-2">
        <Input name="q" type="search" placeholder="Search by name or number" defaultValue={sp.q ?? ""} aria-label="Search employees" className="flex-1" />
        {sp.all ? <input type="hidden" name="all" value="1" /> : null}
        <button type="submit" className={cn(buttonVariants({ variant: "secondary" }), "h-11 md:h-9")}>Search</button>
        <Link href={sp.all ? "?" : "?all=1"} className={cn(buttonVariants({ variant: "ghost" }), "h-11 md:h-9")}>{sp.all ? "Active only" : "Include switched off"}</Link>
      </form>
      <ul className="space-y-2">
        {(data ?? []).map((e) => (
          <li key={e.id}>
            <details className="surface p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{e.full_name}</span>
                <span className="text-sm text-muted-foreground">{[one(e.stores_departments)?.name, e.employee_number].filter(Boolean).join(" · ")}</span>
                {!e.is_active ? <Badge variant="muted">Switched off</Badge> : null}
                <Link href={`/staff/stores/movements?employee=${e.id}`} className="ml-auto text-xs font-medium text-primary hover:underline">History</Link>
              </summary>
              <div className="mt-4"><EmployeeEditor employee={e} departments={departments} campuses={campuses ?? []} /></div>
            </details>
          </li>
        ))}
      </ul>
      {!data?.length ? <p className="mt-4 text-sm text-muted-foreground">{term ? "Nobody matches that search." : "No employees yet. Add one above, or from the checkout screen."}</p> : null}
    </div>
  );
}
