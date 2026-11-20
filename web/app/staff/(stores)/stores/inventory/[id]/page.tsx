import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, HandHelping, PackagePlus, Pencil } from "lucide-react";
import { Pagination } from "@/components/crm/bits";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { AdjustForm } from "@/components/stores/adjust-form";
import { ItemThumb } from "@/components/stores/item-thumb";
import { DueBadge, ItemStatusBadge, ItemTypeBadge, MovementBadge } from "@/components/stores/badges";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { acknowledgements, isPastLastPage } from "@/lib/stores/data";
import { movementHref, shelfChange, transactionHref } from "@/lib/stores/links";
import { ITEM_TYPE_LABELS } from "@/lib/stores/rules";
import { schoolToday } from "@/lib/stores/server";
import { isUuid } from "@/lib/uuid";
import { cn } from "@/lib/utils";

export const metadata = { title: "Item" };

const PAGE = 25;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * One item: what it is, where every unit of it is, and everything that has
 * ever happened to it. The five figures always add up, because the database
 * keeps them as four balances and a total that is their sum.
 */
export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; added?: string; photo?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const { supabase, permissions } = await requireStaff("stores.read");
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const [{ data: item }, { data: moves, count, error: movesError }, { data: loans }, { data: assigned }, ack] = await Promise.all([
    supabase
      .from("stores_items")
      .select("*, stores_categories!stores_items_category_id_fkey(name), stores_locations!stores_items_location_id_fkey(name), stores_item_photos(sha256)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("stores_movements")
      .select("id, occurred_at, movement_type, reference, quantity, available_delta, checked_out_delta, assigned_delta, unavailable_delta, employee_name, department_name, condition, notes, receipt_id, checkout_id, return_id, issue_id, assignment_id, adjustment_id, recorded_by_name", { count: "exact" })
      .eq("item_id", id)
      .order("id", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("v_stores_outstanding").select("*").eq("item_id", id).order("expected_return_date"),
    supabase.from("stores_assignments").select("id, reference, quantity_held, department_name, employee_name, location_note, assigned_at").eq("item_id", id).eq("status", "active").order("assigned_at", { ascending: false }),
    acknowledgements(supabase),
  ]);
  if (!item) notFound();
  if (isPastLastPage(movesError) && page > 1) redirect(`/staff/stores/inventory/${id}`);
  if (movesError) throw new Error(movesError.message);
  const today = schoolToday();
  const writer = can(permissions, "stores.write");
  const admin = can(permissions, "stores.admin");
  const value = item.purchase_price_minor !== null ? formatMoney(item.purchase_price_minor * item.qty_total, "BWP") : null;

  const tiles = [
    { label: "Total", value: item.qty_total, hint: "owned by the school" },
    { label: "Available", value: item.qty_available, hint: "on the shelf", strong: true },
    { label: "Checked out", value: item.qty_checked_out, hint: "on loan" },
    { label: "Permanently assigned", value: item.qty_assigned, hint: "with a department" },
    { label: "Damaged or unavailable", value: item.qty_unavailable, hint: "held back", warn: item.qty_unavailable > 0 },
  ];

  return (
    <>
      <PageTitle
        title={item.name}
        description={[one(item.stores_categories)?.name, ITEM_TYPE_LABELS[item.item_type], one(item.stores_locations)?.name].filter(Boolean).join(" · ")}
        back={{ href: "/staff/stores/inventory", label: "Inventory" }}
      >
        {writer ? (
          <Link href={`/staff/stores/inventory/${item.id}/edit`} className={buttonVariants({ variant: "outline", size: "lg" })}>
            <Pencil aria-hidden /> Edit
          </Link>
        ) : null}
      </PageTitle>

      {sp.added ? (
        <p className="mb-4 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success" role="status">
          {item.name} is on the register{item.qty_total > 0 ? `, with an opening stock of ${item.qty_total}${item.unit !== "each" ? ` ${item.unit}` : ""}` : ""}.
          {sp.photo === "failed" ? <span className="mt-1 block font-medium text-warning-foreground">The photo was not saved. Add it again from Edit.</span> : null}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ItemThumb itemId={item.id} sha256={one(item.stores_item_photos)?.sha256} name={item.name} className="mr-1 size-20 rounded-xl sm:size-24" />
        <ItemStatusBadge item={item} />
        <ItemTypeBadge type={item.item_type} />
        {item.is_low_stock ? <span className="text-xs text-muted-foreground">Reorder level {item.min_stock}</span> : null}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3">
        {tiles.map((t) => (
          <div key={t.label} className={cn("surface px-4 py-3", t.strong && "ring-1 ring-primary/30")}>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t.label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", t.warn && "text-warning-foreground")}>{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.hint}{item.unit !== "each" ? ` · ${item.unit}` : ""}</p>
          </div>
        ))}
      </div>

      {writer && item.is_active ? (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {item.item_type === "reusable" ? (
            <Link href={`/staff/stores/check-out?item=${item.id}`} className={cn(buttonVariants({ size: "lg" }), "h-12 text-base sm:h-9 sm:text-sm")}>
              <ArrowUpFromLine aria-hidden /> Check out
            </Link>
          ) : null}
          {item.item_type === "consumable" ? (
            <Link href={`/staff/stores/issues?item=${item.id}`} className={cn(buttonVariants({ size: "lg" }), "h-12 text-base sm:h-9 sm:text-sm")}>
              <HandHelping aria-hidden /> Issue
            </Link>
          ) : (
            <Link href={`/staff/stores/issues/assign?item=${item.id}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 text-base sm:h-9 sm:text-sm")}>
              <HandHelping aria-hidden /> Assign
            </Link>
          )}
          <Link href={`/staff/stores/receive?item=${item.id}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 text-base sm:h-9 sm:text-sm")}>
            <PackagePlus aria-hidden /> Receive stock
          </Link>
          {item.qty_checked_out > 0 ? (
            <Link href={`/staff/stores/check-in?item=${item.id}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 text-base sm:h-9 sm:text-sm")}>
              <ArrowDownToLine aria-hidden /> Check in
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="history-heading" className="lg:col-span-2">
          <h2 id="history-heading" className="mb-2 text-[15px] font-semibold">Stock movement history</h2>
          {moves && moves.length ? (
            <ul className="surface divide-y divide-border/70">
              {moves.map((m) => {
                const href = movementHref(m);
                const who = [m.employee_name, m.department_name].filter(Boolean).join(" · ");
                return (
                  <li key={m.id} className="relative flex items-start gap-3 px-4 py-3 text-sm has-[a:hover]:bg-muted/40">
                    <span className={cn("mt-0.5 w-12 shrink-0 text-right text-base font-semibold tabular-nums", m.available_delta > 0 ? "text-success" : m.available_delta < 0 ? "text-foreground" : "text-muted-foreground")} title="Change to what is on the shelf">
                      {shelfChange(m.available_delta)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <MovementBadge type={m.movement_type} />
                        <span className="text-xs text-muted-foreground tabular-nums">{m.quantity} {item.unit !== "each" ? item.unit : ""}</span>
                        {m.condition && m.condition !== "good" ? <span className="text-xs font-medium text-warning-foreground">{m.condition.replace("_", " ")}</span> : null}
                      </div>
                      {who ? <p className="mt-0.5 truncate text-foreground">{who}</p> : null}
                      {m.notes ? <p className="mt-0.5 text-xs text-muted-foreground">{m.notes}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(m.occurred_at)} · {m.recorded_by_name} ·{" "}
                        {href ? <Link href={href} className="font-medium text-primary after:absolute after:inset-0 hover:underline">{m.reference}</Link> : m.reference}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>Nothing has happened to this item yet.</EmptyState>
          )}
          <Pagination page={page} pages={Math.ceil((count ?? 0) / PAGE)} qs={(patch) => `?${new URLSearchParams(Object.entries(patch).filter(([, v]) => v) as [string, string][]).toString()}`} />
        </section>

        <aside className="space-y-4">
          {loans && loans.length ? (
            <section className="surface p-4" aria-labelledby="loans-heading">
              <h2 id="loans-heading" className="mb-2 text-sm font-semibold">On loan</h2>
              <ul className="space-y-2">
                {loans.map((l) => (
                  <li key={l.line_id} className="text-sm">
                    <Link href={transactionHref("checkout", l.checkout_id)} className="font-medium hover:underline">{l.employee_name}</Link>
                    <span className="text-muted-foreground"> · {l.quantity_outstanding} of {l.quantity}</span>
                    <div className="mt-1"><DueBadge expected={l.expected_return_date} today={today} soonDays={ack.dueSoonDays} /></div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {assigned && assigned.length ? (
            <section className="surface p-4" aria-labelledby="assigned-heading">
              <h2 id="assigned-heading" className="mb-2 text-sm font-semibold">Permanently assigned</h2>
              <ul className="space-y-2 text-sm">
                {assigned.map((a) => (
                  <li key={a.id}>
                    <Link href={transactionHref("assignment", a.id)} className="font-medium hover:underline">{a.department_name}</Link>
                    <span className="text-muted-foreground"> · {a.quantity_held}{a.employee_name ? ` · ${a.employee_name}` : ""}{a.location_note ? ` · ${a.location_note}` : ""}</span>
                    <span className="block text-xs text-muted-foreground">Since {formatDate(a.assigned_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="surface p-4" aria-labelledby="details-heading">
            <h2 id="details-heading" className="mb-2 text-sm font-semibold">Details</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Unit</dt><dd>{item.unit}</dd></div>
              <div><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Reorder level</dt><dd>{item.min_stock || "None"}</dd></div>
              <div><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Price each</dt><dd>{item.purchase_price_minor !== null ? formatMoney(item.purchase_price_minor, "BWP") : "—"}</dd></div>
              <div><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Value held</dt><dd>{value ?? "—"}</dd></div>
              <div className="col-span-2"><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Supplier</dt><dd>{item.supplier ?? "—"}</dd></div>
              {item.description ? <div className="col-span-2"><dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Description</dt><dd className="whitespace-pre-line">{item.description}</dd></div> : null}
            </dl>
          </section>

          {writer ? (
            <section className="surface p-4" aria-labelledby="adjust-heading">
              <h2 id="adjust-heading" className="mb-1 text-sm font-semibold">Adjust stock</h2>
              <p className="mb-3 text-xs text-muted-foreground">Quantities are never typed over. A correction is recorded as a movement, with a reason and your name.</p>
              <AdjustForm
                itemId={item.id}
                itemType={item.item_type}
                available={item.qty_available}
                unavailable={item.qty_unavailable}
                isAdmin={admin}
                outstanding={(loans ?? []).map((l) => ({ lineId: l.line_id, label: `${l.employee_name}, ${l.reference}: ${l.quantity_outstanding} outstanding`, quantity: l.quantity_outstanding }))}
              />
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
