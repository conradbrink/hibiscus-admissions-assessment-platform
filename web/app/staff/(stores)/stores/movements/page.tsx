import Link from "next/link";
import { Download } from "lucide-react";
import { Pagination, queryBuilder } from "@/components/crm/bits";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { MovementBadge } from "@/components/stores/badges";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { listEmployees, listItems, listNamed } from "@/lib/stores/data";
import { movementHref, shelfChange } from "@/lib/stores/links";
import { MOVEMENT_LABELS, MOVEMENT_TYPES, type MovementType } from "@/lib/stores/rules";
import { isUuid } from "@/lib/uuid";
import { cn } from "@/lib/utils";

export const metadata = { title: "Stock movements" };

type Search = { from?: string; to?: string; item?: string; category?: string; type?: string; employee?: string; department?: string; page?: string };
const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The complete history of the storeroom, newest first: every receipt,
 * checkout, return, issue, assignment, adjustment and reversal, one line per
 * item, each with who recorded it. Nothing here can be edited; a line opens
 * its transaction, which shows the signature where there is one.
 */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("stores.read");
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const type = MOVEMENT_TYPES.includes(sp.type as MovementType) ? (sp.type as MovementType) : null;

  let q = supabase.from("v_stores_movements").select("*", { count: "exact" }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.from && DATE.test(sp.from)) q = q.gte("occurred_at", `${sp.from}T00:00:00+02:00`);
  if (sp.to && DATE.test(sp.to)) q = q.lte("occurred_at", `${sp.to}T23:59:59.999+02:00`);
  if (isUuid(sp.item)) q = q.eq("item_id", sp.item);
  if (isUuid(sp.category)) q = q.eq("category_id", sp.category);
  if (isUuid(sp.employee)) q = q.eq("employee_id", sp.employee);
  if (isUuid(sp.department)) q = q.eq("department_id", sp.department);
  if (type) q = q.eq("movement_type", type);

  const [{ data, count, error }, items, categories, employees, departments] = await Promise.all([
    q,
    listItems(supabase),
    listNamed(supabase, "stores_categories", { includeInactive: true }),
    listEmployees(supabase, { includeInactive: true }),
    listNamed(supabase, "stores_departments", { includeInactive: true }),
  ]);
  if (error) throw new Error(error.message);
  const qs = queryBuilder(sp);
  const filtered = Boolean(sp.from || sp.to || sp.item || sp.category || type || sp.employee || sp.department);
  const exportQs = new URLSearchParams({ kind: "movements", ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), ...(sp.category ? { category: sp.category } : {}) }).toString();

  return (
    <>
      <PageTitle title="Stock movements" description={`${count ?? 0} ${count === 1 ? "movement" : "movements"}${filtered ? " match" : " recorded"}. Corrections appear as their own lines; nothing is overwritten.`}>
        <a href={`/staff/stores/reports/export?${exportQs}&format=csv`} className={buttonVariants({ variant: "outline", size: "lg" })}><Download aria-hidden /> CSV</a>
      </PageTitle>

      <details className="surface mb-4 p-4 print:hidden" open={filtered}>
        <summary className="cursor-pointer text-sm font-medium">Filter{filtered ? " (on)" : ""}</summary>
        <form method="get" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">From<Input type="date" name="from" defaultValue={sp.from ?? ""} /></label>
          <label className="space-y-1 text-xs text-muted-foreground">To<Input type="date" name="to" defaultValue={sp.to ?? ""} /></label>
          <label className="space-y-1 text-xs text-muted-foreground">Movement type
            <NativeSelect name="type" defaultValue={type ?? ""}><option value="">Any movement</option>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}</NativeSelect>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Item
            <NativeSelect name="item" defaultValue={sp.item ?? ""}><option value="">Any item</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Category
            <NativeSelect name="category" defaultValue={sp.category ?? ""}><option value="">Any category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Employee
            <NativeSelect name="employee" defaultValue={sp.employee ?? ""}><option value="">Anyone</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</NativeSelect>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Department
            <NativeSelect name="department" defaultValue={sp.department ?? ""}><option value="">Any department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className={cn(buttonVariants({ variant: "secondary" }), "h-11 flex-1 md:h-9")}>Apply</button>
            {filtered ? <Link href="/staff/stores/movements" className={cn(buttonVariants({ variant: "ghost" }), "h-11 md:h-9")}>Clear</Link> : null}
          </div>
        </form>
      </details>

      {data && data.length ? (
        <>
          <ul className="space-y-2 md:hidden">
            {data.map((m) => {
              const href = movementHref(m);
              return (
                <li key={m.id} className="surface relative px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{m.quantity} × {m.item_name}</span>
                    <MovementBadge type={m.movement_type} />
                  </div>
                  <p className="mt-0.5 truncate text-muted-foreground">{[m.employee_name, m.department_name].filter(Boolean).join(" · ") || "Storeroom"}</p>
                  {m.notes ? <p className="mt-0.5 text-xs text-muted-foreground">{m.notes}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(m.occurred_at)} · {m.recorded_by_name} · <span className="font-medium text-primary">{m.reference}</span></p>
                  {href ? <Link href={href} className="absolute inset-0" aria-label={`Open ${m.reference}`} /> : null}
                </li>
              );
            })}
          </ul>
          <div className="surface hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Reference</th><th>Movement</th><th>Item</th><th className="text-right">Qty</th><th className="text-right" title="Change to what is on the shelf">Shelf</th><th>Employee / department</th><th>Recorded by</th><th>Notes</th></tr></thead>
              <tbody>
                {data.map((m) => {
                  const href = movementHref(m);
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">{formatDateTime(m.occurred_at)}</td>
                      <td className="whitespace-nowrap">{href ? <Link href={href} className="font-medium text-primary hover:underline">{m.reference}</Link> : m.reference}</td>
                      <td><MovementBadge type={m.movement_type} /></td>
                      <td><Link href={`/staff/stores/inventory/${m.item_id}`} className="hover:underline">{m.item_name}</Link><span className="block text-xs text-muted-foreground">{m.category_name}</span></td>
                      <td className="text-right tabular-nums">{m.quantity}</td>
                      <td className={cn("text-right tabular-nums", m.available_delta > 0 && "text-success")}>{shelfChange(m.available_delta)}</td>
                      <td className="text-muted-foreground">{[m.employee_name, m.department_name].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{m.recorded_by_name}</td>
                      <td className="max-w-56 text-xs text-muted-foreground">{m.notes ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={Math.ceil((count ?? 0) / PAGE)} qs={qs} />
        </>
      ) : (
        <EmptyState>{filtered ? "No movement matches these filters." : "No stock has moved yet."}</EmptyState>
      )}
    </>
  );
}
