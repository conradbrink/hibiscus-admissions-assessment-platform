import Link from "next/link";
import { ChevronRight, PackagePlus, Plus } from "lucide-react";
import { Pagination, queryBuilder } from "@/components/crm/bits";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { ItemStatusBadge, ItemTypeBadge } from "@/components/stores/badges";
import { ItemThumb } from "@/components/stores/item-thumb";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { listNamed, searchTerm } from "@/lib/stores/data";
import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from "@/lib/stores/rules";
import { cn } from "@/lib/utils";

export const metadata = { title: "Inventory" };

type Search = { q?: string; category?: string; type?: string; show?: string; page?: string };
const PAGE = 50;
const SHOWS = [
  { key: "", label: "All items" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "None on the shelf" },
  { key: "loan", label: "On loan" },
  { key: "held", label: "Damaged or unavailable" },
  { key: "off", label: "Switched off" },
] as const;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The register: every item the school holds, what it is, how many it owns
 * and how many are on the shelf. Searchable and filterable, one page of fifty
 * at a time; a table on a wide screen and a card per item on a phone.
 */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("stores.read");
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const term = searchTerm(sp.q);
  const type = ITEM_TYPES.includes(sp.type as ItemType) ? (sp.type as ItemType) : null;
  const show = SHOWS.some((s) => s.key === sp.show) ? (sp.show ?? "") : "";

  let q = supabase
    .from("stores_items")
    .select("id, name, item_type, unit, min_stock, qty_available, qty_checked_out, qty_assigned, qty_unavailable, qty_total, is_active, stores_categories!stores_items_category_id_fkey(name), stores_locations!stores_items_location_id_fkey(name), stores_item_photos(sha256)", { count: "exact" })
    .order("name")
    .range((page - 1) * PAGE, page * PAGE - 1);
  q = show === "off" ? q.eq("is_active", false) : q.eq("is_active", true);
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%,supplier.ilike.%${term}%`);
  if (sp.category) q = q.eq("category_id", sp.category);
  if (type) q = q.eq("item_type", type);
  if (show === "low") q = q.eq("is_low_stock", true);
  if (show === "out") q = q.eq("qty_available", 0);
  if (show === "loan") q = q.gt("qty_checked_out", 0);
  if (show === "held") q = q.gt("qty_unavailable", 0);

  const [{ data: items, count, error }, categories] = await Promise.all([q, listNamed(supabase, "stores_categories")]);
  if (error) throw new Error(error.message);
  const total = count ?? 0;
  const qs = queryBuilder(sp);
  const writer = can(permissions, "stores.write");

  return (
    <>
      <PageTitle title="Inventory" description={`${total} ${total === 1 ? "item" : "items"}${show || term || sp.category || type ? " match" : " on the register"}`}>
        {writer ? (
          <>
            <Link href="/staff/stores/receive" className={buttonVariants({ variant: "outline", size: "lg" })}>
              <PackagePlus aria-hidden /> Receive stock
            </Link>
            <Link href="/staff/stores/inventory/new" className={buttonVariants({ size: "lg" })}>
              <Plus aria-hidden /> Add item
            </Link>
          </>
        ) : null}
      </PageTitle>

      <form method="get" className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]" role="search">
        {show ? <input type="hidden" name="show" value={show} /> : null}
        <Input name="q" type="search" placeholder="Search by item, description or supplier" defaultValue={sp.q ?? ""} aria-label="Search the inventory" />
        <NativeSelect name="category" defaultValue={sp.category ?? ""} aria-label="Category">
          <option value="">Every category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect name="type" defaultValue={type ?? ""} aria-label="Item type">
          <option value="">Every type</option>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}
        </NativeSelect>
        <button type="submit" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "h-11 md:h-9")}>Search</button>
      </form>
      {/* The admissions filter chips, a size up on a phone: 40px to hit with a thumb. */}
      <nav aria-label="Show" className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {SHOWS.map((s) => (
          <Link
            key={s.key}
            href={qs({ show: s.key || undefined, page: undefined })}
            aria-current={show === s.key ? "true" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center rounded-md border px-3 text-sm whitespace-nowrap transition-colors md:min-h-0 md:px-2.5 md:py-1 md:text-[13px]",
              show === s.key ? "border-primary/40 bg-accent font-medium text-accent-foreground" : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {items && items.length ? (
        <>
          {/* A phone: one card per item, the numbers that matter large. */}
          <ul className="space-y-2 md:hidden">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/staff/stores/inventory/${i.id}`} className="surface flex items-center gap-3 px-3 py-3 active:bg-muted/60">
                  <ItemThumb itemId={i.id} sha256={one(i.stores_item_photos)?.sha256} name={i.name} className="size-14" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-foreground">{i.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{one(i.stores_categories)?.name} · {ITEM_TYPE_LABELS[i.item_type]}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ItemStatusBadge item={i} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl leading-none font-semibold tabular-nums">{i.qty_available}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">of {i.qty_total} {i.unit !== "each" ? i.unit : ""} available</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {/* A tablet or a laptop: the register as a table. */}
          <div className="surface hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th className="text-right">Total Stock</th>
                  <th className="text-right">Available</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <ItemThumb itemId={i.id} sha256={one(i.stores_item_photos)?.sha256} name={i.name} className="size-10" />
                        <div className="min-w-0">
                          <Link href={`/staff/stores/inventory/${i.id}`} className="font-medium text-foreground hover:underline">{i.name}</Link>
                          {one(i.stores_locations)?.name ? <span className="block text-xs text-muted-foreground">{one(i.stores_locations)?.name}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted-foreground">{one(i.stores_categories)?.name}</td>
                    <td><ItemTypeBadge type={i.item_type} /></td>
                    <td className="text-right tabular-nums">{i.qty_total} <span className="text-xs text-muted-foreground">{i.unit !== "each" ? i.unit : ""}</span></td>
                    <td className="text-right font-semibold tabular-nums">{i.qty_available}</td>
                    <td><ItemStatusBadge item={i} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={Math.ceil(total / PAGE)} qs={qs} />
        </>
      ) : (
        <EmptyState>
          {term || sp.category || type || show
            ? "Nothing on the register matches. Clear the search or choose another filter."
            : writer
              ? "The register is empty. Add the first item, or receive stock and create the item as you do."
              : "The register is empty."}
        </EmptyState>
      )}
    </>
  );
}
