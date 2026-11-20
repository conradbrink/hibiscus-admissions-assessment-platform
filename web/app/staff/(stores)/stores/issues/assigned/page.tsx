import Link from "next/link";
import { EmptyState } from "@/components/staff/page-title";
import { IssuesHeader } from "@/components/stores/issues-tabs";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { searchTerm } from "@/lib/stores/data";
import { transactionHref } from "@/lib/stores/links";
import { cn } from "@/lib/utils";

export const metadata = { title: "Assigned assets" };

/** The asset register's other half: everything placed with a department, and who answers for it. */
export default async function AssignedPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("stores.write");
  const term = searchTerm(sp.q);
  let q = supabase.from("stores_assignments").select("id, reference, item_id, item_name, quantity_held, unit, department_name, employee_name, location_note, assigned_at").eq("status", "active").order("department_name").order("item_name").limit(2000);
  if (term) q = q.or(`item_name.ilike.%${term}%,department_name.ilike.%${term}%,employee_name.ilike.%${term}%,location_note.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (
    <div className="mx-auto max-w-4xl">
      <IssuesHeader current="assigned" description="Open one to return it to the storeroom. The full register, with export, is under Reports." />
      <form method="get" role="search" className="mb-4 flex gap-2">
        <Input name="q" type="search" placeholder="Search by item, department, person or place" defaultValue={sp.q ?? ""} aria-label="Search assigned assets" />
        <button type="submit" className={cn(buttonVariants({ variant: "secondary" }), "h-11 px-4 md:h-9")}>Search</button>
      </form>
      {data && data.length ? (
        <ul className="space-y-2">
          {data.map((a) => (
            <li key={a.id}>
              <Link href={transactionHref("assignment", a.id)} className="surface flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:shadow-lift">
                <span className="min-w-0">
                  <span className="block font-semibold">{a.quantity_held} × {a.item_name}</span>
                  <span className="block text-sm text-muted-foreground">{[a.department_name, a.employee_name, a.location_note].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-xs text-muted-foreground">{a.reference} · since {formatDate(a.assigned_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>{term ? "No assigned asset matches that search." : "Nothing is permanently assigned."}</EmptyState>
      )}
    </div>
  );
}
