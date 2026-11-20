import Link from "next/link";
import { AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpFromLine, Boxes, CircleCheck, Clock, HandHelping, PackageCheck, PackagePlus, TriangleAlert } from "lucide-react";
import { StatTile } from "@/components/staff/stat-tile";
import { DueBadge, MovementBadge } from "@/components/stores/badges";
import { formatDate, formatDateTime, formatWeekdayDate } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { acknowledgements } from "@/lib/stores/data";
import { movementHref, transactionHref } from "@/lib/stores/links";
import { dueState } from "@/lib/stores/rules";
import { schoolToday } from "@/lib/stores/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

type Counts = Record<string, number>;

/**
 * The storeroom at a glance: the five figures, who has what and when it is
 * due, what is running low, and what has just happened. Every figure comes
 * from the database in one call, and the page says at the foot whether the
 * balances agree with their history.
 */
export default async function StoresDashboardPage() {
  const { supabase, permissions } = await requireStaff("stores.read");
  const [{ data: countsRaw }, { data: outstanding }, { data: low }, { data: recent }, { data: recon }, ack] = await Promise.all([
    supabase.rpc("stores_dashboard_counts"),
    supabase.from("v_stores_outstanding").select("*").order("expected_return_date").order("employee_name").limit(8),
    supabase.from("stores_items").select("id, name, unit, qty_available, min_stock").eq("is_active", true).eq("is_low_stock", true).order("qty_available").limit(8),
    supabase.from("v_stores_movements").select("id, occurred_at, movement_type, reference, item_id, item_name, quantity, unit, employee_name, department_name, recorded_by_name, receipt_id, checkout_id, return_id, issue_id, assignment_id, adjustment_id").order("id", { ascending: false }).limit(10),
    supabase.rpc("stores_reconciliation"),
    acknowledgements(supabase),
  ]);
  const c = (countsRaw ?? {}) as Counts;
  const n = (k: string) => Number(c[k] ?? 0);
  const today = schoolToday();
  const writer = can(permissions, "stores.write");

  const quick = [
    { href: "/staff/stores/check-out", label: "Check out", icon: ArrowUpFromLine },
    { href: "/staff/stores/check-in", label: "Check in", icon: ArrowDownToLine },
    { href: "/staff/stores/issues", label: "Issue stock", icon: HandHelping },
    { href: "/staff/stores/receive", label: "Receive stock", icon: PackagePlus },
  ];

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-foreground">Hibiscus Stores</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatWeekdayDate(new Date(`${today}T12:00:00+02:00`))}</p>
      </div>

      {writer ? (
        <nav aria-label="Storeroom actions" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="surface flex min-h-16 items-center gap-3 px-4 py-3 text-base font-semibold text-foreground transition-shadow hover:shadow-lift active:bg-muted/60 sm:text-sm">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary"><q.icon className="size-5" aria-hidden /></span>
              {q.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-label="The storeroom in figures" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3">
        <StatTile label="Total inventory items" value={n("total_items")} icon={Boxes} href="/staff/stores/inventory" />
        <StatTile label="Available equipment" value={n("available_equipment")} icon={PackageCheck} tone="success" href="/staff/stores/inventory?type=reusable" hint="on the shelf" />
        <StatTile label="Checked out" value={n("checked_out")} icon={ArrowUpFromLine} tone="info" href={writer ? "/staff/stores/check-in" : "/staff/stores/reports/outstanding"} hint={`${n("open_checkouts")} ${n("open_checkouts") === 1 ? "checkout" : "checkouts"}`} />
        <StatTile label="Overdue equipment" value={n("overdue_quantity")} icon={Clock} tone="destructive" href="/staff/stores/reports/overdue" hint={n("overdue_checkouts") ? `${n("overdue_checkouts")} ${n("overdue_checkouts") === 1 ? "checkout" : "checkouts"}` : "nothing late"} />
        <StatTile label="Low stock items" value={n("low_stock")} icon={TriangleAlert} tone="warning" href="/staff/stores/inventory?show=low" hint={n("out_of_stock") ? `${n("out_of_stock")} with none on the shelf` : undefined} />
      </section>

      <div className="grid gap-7 lg:grid-cols-3 lg:gap-6">
        <section aria-labelledby="out-heading" className="lg:col-span-2">
          <Header id="out-heading" title="Outstanding equipment" href={writer ? "/staff/stores/check-in" : "/staff/stores/reports/outstanding"} link="All outstanding" />
          {outstanding && outstanding.length ? (
            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {outstanding.map((o) => {
                const due = dueState(o.expected_return_date, today, ack.dueSoonDays);
                return (
                  <li
                    key={o.line_id}
                    className={cn(
                      "relative border-t border-border/70 px-4 py-3 text-sm first:border-t-0",
                      due.state === "overdue" && "border-l-4 border-l-destructive bg-destructive/[0.04]",
                      due.state === "due_soon" && "border-l-4 border-l-warning bg-warning/[0.08]"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <Link href={transactionHref("checkout", o.checkout_id)} className="font-semibold text-foreground after:absolute after:inset-0 hover:underline">{o.employee_name}</Link>
                      <DueBadge expected={o.expected_return_date} today={today} soonDays={ack.dueSoonDays} />
                    </div>
                    <p className="mt-0.5 text-foreground">
                      {o.quantity_outstanding} × {o.item_name}
                      {o.quantity_outstanding !== o.quantity ? <span className="text-muted-foreground"> (of {o.quantity} issued)</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Out {formatDate(o.checked_out_at)} · due {formatDate(o.expected_return_date)}{o.department_name ? ` · ${o.department_name}` : ""}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Quiet>Nothing is out on loan.</Quiet>
          )}
        </section>

        <section aria-labelledby="low-heading">
          <Header id="low-heading" title="Low stock alerts" href="/staff/stores/reports/low-stock" link="Report" />
          {low && low.length ? (
            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {low.map((i) => (
                <li key={i.id} className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5 text-sm first:border-t-0">
                  <AlertTriangle className={cn("size-4 shrink-0", i.qty_available === 0 ? "text-destructive" : "text-warning")} aria-hidden />
                  <Link href={`/staff/stores/inventory/${i.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{i.name}</Link>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className={cn("font-semibold", i.qty_available === 0 && "text-destructive")}>{i.qty_available}</span>
                    <span className="text-xs text-muted-foreground"> / reorder at {i.min_stock}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Quiet>Nothing is at or under its reorder level.</Quiet>
          )}
        </section>
      </div>

      <section aria-labelledby="recent-heading">
        <Header id="recent-heading" title="Recent stock movements" href="/staff/stores/movements" link="All movements" />
        {recent && recent.length ? (
          <>
            <ul className="overflow-hidden rounded-xl border border-border bg-card md:hidden">
              {recent.map((m) => {
                const href = movementHref(m);
                return (
                  <li key={m.id} className="relative border-t border-border/70 px-4 py-3 text-sm first:border-t-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{m.quantity} × {m.item_name}</span>
                      <MovementBadge type={m.movement_type} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[m.employee_name, m.department_name].filter(Boolean).join(" · ") || "Storeroom"} · {formatDateTime(m.occurred_at)} · {m.recorded_by_name}
                    </p>
                    {href ? <Link href={href} className="absolute inset-0" aria-label={`Open ${m.reference}`} /> : null}
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
              <table className="data-table">
                <thead><tr><th>Item</th><th>Movement</th><th className="text-right">Quantity</th><th>Employee / department</th><th>Date</th><th>Recorded by</th><th>Reference</th></tr></thead>
                <tbody>
                  {recent.map((m) => {
                    const href = movementHref(m);
                    return (
                      <tr key={m.id}>
                        <td><Link href={`/staff/stores/inventory/${m.item_id}`} className="font-medium hover:underline">{m.item_name}</Link></td>
                        <td><MovementBadge type={m.movement_type} /></td>
                        <td className="text-right tabular-nums">{m.quantity}</td>
                        <td className="text-muted-foreground">{[m.employee_name, m.department_name].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="whitespace-nowrap">{formatDateTime(m.occurred_at)}</td>
                        <td>{m.recorded_by_name}</td>
                        <td className="whitespace-nowrap">{href ? <Link href={href} className="font-medium text-primary hover:underline">{m.reference}</Link> : m.reference}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Quiet>No stock has moved yet.</Quiet>
        )}
      </section>

      <p className={cn("flex items-center gap-2 text-xs", recon && recon.length ? "text-destructive" : "text-muted-foreground")}>
        {recon && recon.length ? <TriangleAlert className="size-3.5" aria-hidden /> : <CircleCheck className="size-3.5 text-success" aria-hidden />}
        {recon && recon.length
          ? `${recon.length} ${recon.length === 1 ? "balance does" : "balances do"} not agree with the history. Tell a Stores administrator: ${recon.map((r) => r.item_name).join(", ")}.`
          : "Every balance agrees with its stock movement history."}
      </p>
    </div>
  );
}

function Header({ id, title, href, link }: { id: string; title: string; href: string; link: string }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <h2 id={id} className="text-[15px] font-semibold text-foreground">{title}</h2>
      <Link href={href} className="group -my-2 inline-flex min-h-10 items-center gap-1 py-2 text-[13px] font-medium text-primary hover:text-accent-foreground md:min-h-0">
        {link} <ArrowRight className="size-3.5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground">
      <span className="size-1.5 rounded-full bg-success" aria-hidden />
      {children}
    </p>
  );
}
