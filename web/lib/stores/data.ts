import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, StoresItemType } from "@/lib/supabase/types";
import { itemPhotoUrl } from "@/lib/stores/photo";

type Client = SupabaseClient<Database>;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The reads several Stores screens share. Plain async functions taking the
 * caller's own client, so row-level security decides what comes back, and
 * throwing on an error as every domain module here does.
 */

export type EmployeeChoice = { id: string; full_name: string; department_id: string; department_name: string; employee_number: string | null; is_active: boolean };

export async function listEmployees(supabase: Client, opts: { includeInactive?: boolean } = {}): Promise<EmployeeChoice[]> {
  let q = supabase
    .from("stores_employees")
    .select("id, full_name, department_id, employee_number, is_active, stores_departments!stores_employees_department_id_fkey(name)")
    .order("full_name")
    .limit(5000);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id,
    full_name: e.full_name,
    department_id: e.department_id,
    department_name: one(e.stores_departments)?.name ?? "",
    employee_number: e.employee_number,
    is_active: e.is_active,
  }));
}

export type ItemChoice = {
  id: string;
  name: string;
  unit: string;
  item_type: StoresItemType;
  qty_available: number;
  qty_unavailable: number;
  category_name: string;
  /** The photo's address, when the item has one. */
  photo_url: string | null;
};

export async function listItems(supabase: Client, types?: readonly StoresItemType[]): Promise<ItemChoice[]> {
  let q = supabase
    .from("stores_items")
    .select("id, name, unit, item_type, qty_available, qty_unavailable, stores_categories!stores_items_category_id_fkey(name), stores_item_photos(sha256)")
    .eq("is_active", true)
    .order("name")
    .limit(5000);
  if (types?.length) q = q.in("item_type", [...types]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    item_type: i.item_type,
    qty_available: i.qty_available,
    qty_unavailable: i.qty_unavailable,
    category_name: one(i.stores_categories)?.name ?? "",
    photo_url: itemPhotoUrl(i.id, one(i.stores_item_photos)?.sha256),
  }));
}

export type NamedChoice = { id: string; name: string; is_active: boolean };

export async function listNamed(
  supabase: Client,
  table: "stores_departments" | "stores_categories" | "stores_locations",
  opts: { includeInactive?: boolean } = {}
): Promise<NamedChoice[]> {
  let q = supabase.from(table).select("id, name, is_active").order("name").limit(1000);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The two acknowledgements, as the settings hold them now. */
export async function acknowledgements(supabase: Client): Promise<{ checkout: string; return: string; dueSoonDays: number }> {
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["stores_checkout_acknowledgement", "stores_return_acknowledgement", "stores_due_soon_days"]);
  if (error) throw new Error(error.message);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  const days = Number(get("stores_due_soon_days"));
  return {
    checkout: String(get("stores_checkout_acknowledgement") ?? ""),
    return: String(get("stores_return_acknowledgement") ?? ""),
    dueSoonDays: Number.isFinite(days) && days >= 0 ? days : 2,
  };
}

/**
 * A search box's words, made safe for a PostgREST `or` filter: commas,
 * brackets, dots and wildcards are filter syntax there, not text, so they are
 * dropped rather than passed through.
 */
export function searchTerm(raw: string | undefined | null): string | null {
  const s = (raw ?? "").replace(/[,().*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return s || null;
}
