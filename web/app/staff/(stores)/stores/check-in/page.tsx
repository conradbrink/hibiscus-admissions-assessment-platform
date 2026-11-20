import Link from "next/link";
import { ArrowDownToLine, ChevronRight } from "lucide-react";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { DueBadge } from "@/components/stores/badges";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { acknowledgements, searchTerm } from "@/lib/stores/data";
import { dueState, quantityLine } from "@/lib/stores/rules";
import { schoolToday } from "@/lib/stores/server";
import type { StoresOutstandingRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid";

export const metadata = { title: "Check in equipment" };

type Group = { checkoutId: string; reference: string; employee: string; department: string | null; checkedOut: string; expected: string; lines: StoresOutstandingRow[] };

/**
 * Everything out on loan, overdue first, searchable by the employee or the
 * equipment. One card per checkout on a phone, because a return is signed
 * per checkout; the table on a wide screen lists every item with the
 * figures the school asked for.
 */
export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ q?: string; item?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("stores.write");
  const term = searchTerm(sp.q);
  // From an item's own page: the loans of exactly that item, not of every
  // item whose name happens to contain its name.
  const itemId = isUuid(sp.item) ? sp.item : null;
  let q = supabase.from("v_stores_outstanding").select("*").order("expected_return_date").order("employee_name").limit(2000);
  if (term) q = q.or(`employee_name.ilike.%${term}%,item_name.ilike.%${term}%,reference.ilike.%${term}%,department_name.ilike.%${term}%`);
  if (itemId) q = q.eq("item_id", itemId);
  const [{ data, error }, ack] = await Promise.all([q, acknowledgements(supabase)]);
  if (error) throw new Error(error.message);
  const today = schoolToday();
  const groups = new Map<string, Group>();
  for (const r of data ?? []) {
    const g = groups.get(r.checkout_id) ?? { checkoutId: r.checkout_id, reference: r.reference, employee: r.employee_name, department: r.department_name, checkedOut: r.checked_out_at, expected: r.expected_return_date, lines: [] };
    g.lines.push(r);
    groups.set(r.checkout_id, g);
  }
  const list = [...groups.values()];
  const overdue = list.filter((g) => dueState(g.expected, today).state === "overdue").length;

  return (
    <>
      <PageTitle
        title="Check in equipment"
        description={list.length ? `${list.length} ${list.length === 1 ? "checkout" : "checkouts"} with ${itemId ? `${list[0].lines[0]?.item_name ?? "this item"}` : "equipment"} out${overdue ? `, ${overdue} overdue` : ""}.` : itemId ? "None of this item is out on loan." : "Nothing is out on loan."}
      >
        {itemId ? <Link href="/staff/stores/check-in" className={buttonVariants({ variant: "outline" })}>Show every loan</Link> : null}
      </PageTitle>
      <form method="get" role="search" className="mb-4 flex gap-2">
        <Input name="q" type="search" placeholder="Search by employee, equipment or reference" defaultValue={sp.q ?? ""} aria-label="Search outstanding equipment" autoFocus={!sp.q} />
        <button type="submit" className={cn(buttonVariants({ variant: "secondary" }), "h-11 px-4 md:h-9")}>Search</button>
      </form>

      {list.length ? (
        <>
          <ul className="space-y-2 md:hidden">
            {list.map((g) => (
              <li key={g.checkoutId}>
                <Link href={`/staff/stores/check-in/${g.checkoutId}`} className="surface flex items-center gap-3 p-4 active:bg-muted/60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold">{g.employee}</p>
                    <p className="truncate text-xs text-muted-foreground">{[g.department, g.reference, `out ${formatDate(g.checkedOut)}`].filter(Boolean).join(" · ")}</p>
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {g.lines.map((l) => (
                        <li key={l.line_id}>
                          {quantityLine(l.quantity_outstanding, l.item_name, l.unit)}
                          {l.quantity_returned ? <span className="text-xs text-muted-foreground"> (of {l.quantity}, {l.quantity_returned} back)</span> : null}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2"><DueBadge expected={g.expected} today={today} soonDays={ack.dueSoonDays} /></div>
                  </div>
                  <span className="flex shrink-0 flex-col items-center gap-1 text-primary">
                    <ArrowDownToLine className="size-5" aria-hidden />
                    <span className="text-[11px] font-medium">Return</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <div className="surface hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Equipment</th><th className="text-right">Issued</th><th className="text-right">Returned</th><th className="text-right">Outstanding</th><th>Checked out</th><th>Expected return</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {list.flatMap((g) =>
                  g.lines.map((l, i) => (
                    <tr key={l.line_id} className={cn(dueState(g.expected, today, ack.dueSoonDays).state === "overdue" && "bg-destructive/[0.04]")}>
                      <td>{i === 0 ? <><span className="font-medium">{g.employee}</span><span className="block text-xs text-muted-foreground">{g.department}</span></> : null}</td>
                      <td>{l.item_name}</td>
                      <td className="text-right tabular-nums">{l.quantity}</td>
                      <td className="text-right tabular-nums">{l.quantity_returned}</td>
                      <td className="text-right font-semibold tabular-nums">{l.quantity_outstanding}</td>
                      <td className="whitespace-nowrap">{i === 0 ? formatDate(g.checkedOut) : null}</td>
                      <td className="whitespace-nowrap">{i === 0 ? formatDate(g.expected) : null}</td>
                      <td>{i === 0 ? <DueBadge expected={g.expected} today={today} soonDays={ack.dueSoonDays} /> : null}</td>
                      <td className="text-right">{i === 0 ? <Link href={`/staff/stores/check-in/${g.checkoutId}`} className={buttonVariants({ size: "sm" })}>Return</Link> : null}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState>{term ? "No outstanding equipment matches that search." : "Nothing is out on loan. Everything checked out has come back."}</EmptyState>
      )}
    </>
  );
}
