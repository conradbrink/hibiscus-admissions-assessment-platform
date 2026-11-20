import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import type { Database, StoresItemType, StoresMovementType } from "@/lib/supabase/types";
import { CONDITION_LABELS, ITEM_STATUS_LABELS, ITEM_TYPE_LABELS, MOVEMENT_LABELS, dueState, itemStatus, type Condition } from "@/lib/stores/rules";
import { shelfChange } from "@/lib/stores/links";
import type { Cell } from "@/lib/stores/export";

type Client = SupabaseClient<Database>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export const REPORT_KINDS = ["inventory", "outstanding", "overdue", "consumables", "movements", "low-stock", "assigned", "valuation"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORTS: Record<ReportKind, { title: string; blurb: string; dated: boolean; dateLabel?: string }> = {
  inventory: { title: "Current inventory", blurb: "Every item on the register, with where each unit is.", dated: false },
  outstanding: { title: "Outstanding equipment", blurb: "Everything out on loan now, and when it is due back.", dated: true, dateLabel: "Checked out" },
  overdue: { title: "Overdue equipment", blurb: "Loans past their return date, longest overdue first.", dated: false },
  consumables: { title: "Consumables usage", blurb: "What was issued, by item and department, net of reversals.", dated: true, dateLabel: "Issued" },
  movements: { title: "Stock movements", blurb: "Every movement in a period, as recorded.", dated: true, dateLabel: "Occurred" },
  "low-stock": { title: "Low stock", blurb: "Items at or under their reorder level.", dated: false },
  assigned: { title: "Permanently assigned assets", blurb: "The asset register: what is with each department, and who answers for it.", dated: true, dateLabel: "Assigned" },
  valuation: { title: "Inventory valuation", blurb: "What the register is worth, at the price last paid. Items with no price are listed apart.", dated: false },
};

export type Column = { label: string; align?: "right"; money?: boolean };
export type Report = { columns: Column[]; rows: Cell[][]; summary?: string; footer?: Cell[] };
export type ReportFilters = { from: string; to: string; category?: string | null };

/** The rows of one report, read through the caller's own client. Money cells are minor units; the page and the export each format them. */
export async function buildReport(supabase: Client, kind: ReportKind, f: ReportFilters, today: string): Promise<Report> {
  const fromTs = `${f.from}T00:00:00+02:00`;
  const toTs = `${f.to}T23:59:59.999+02:00`;
  switch (kind) {
    case "inventory": {
      let q = supabase
        .from("stores_items")
        .select("name, item_type, unit, min_stock, qty_available, qty_checked_out, qty_assigned, qty_unavailable, qty_total, is_active, stores_categories!stores_items_category_id_fkey(name), stores_locations!stores_items_location_id_fkey(name)")
        .eq("is_active", true)
        .order("name")
        .limit(10000);
      if (f.category) q = q.eq("category_id", f.category);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return {
        columns: [{ label: "Item" }, { label: "Category" }, { label: "Type" }, { label: "Unit" }, { label: "Location" }, { label: "Total", align: "right" }, { label: "Available", align: "right" }, { label: "Checked out", align: "right" }, { label: "Assigned", align: "right" }, { label: "Damaged / unavailable", align: "right" }, { label: "Reorder level", align: "right" }, { label: "Status" }],
        rows: (data ?? []).map((i) => [i.name, one(i.stores_categories)?.name ?? null, ITEM_TYPE_LABELS[i.item_type as StoresItemType], i.unit, one(i.stores_locations)?.name ?? null, i.qty_total, i.qty_available, i.qty_checked_out, i.qty_assigned, i.qty_unavailable, i.min_stock, ITEM_STATUS_LABELS[itemStatus(i)]]),
        summary: `${data?.length ?? 0} items in use.`,
      };
    }
    case "outstanding":
    case "overdue": {
      let q = supabase.from("v_stores_outstanding").select("*").order("expected_return_date").order("employee_name").limit(10000);
      if (kind === "overdue") q = q.eq("is_overdue", true);
      else q = q.gte("checked_out_at", fromTs).lte("checked_out_at", toTs);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      return {
        columns: [{ label: "Employee" }, { label: "Department" }, { label: "Equipment" }, { label: "Issued", align: "right" }, { label: "Returned", align: "right" }, { label: "Outstanding", align: "right" }, { label: "Checked out" }, { label: "Expected return" }, { label: kind === "overdue" ? "Days overdue" : "Status", align: kind === "overdue" ? "right" : undefined }, { label: "Reference" }],
        rows: rows.map((o) => [o.employee_name, o.department_name, o.item_name, o.quantity, o.quantity_returned, o.quantity_outstanding, formatDate(o.checked_out_at), formatDate(o.expected_return_date), kind === "overdue" ? o.days_overdue : dueState(o.expected_return_date, today).label, o.reference]),
        summary: `${rows.reduce((n, o) => n + o.quantity_outstanding, 0)} units on ${new Set(rows.map((o) => o.checkout_id)).size} checkouts.`,
      };
    }
    case "consumables": {
      const { data, error } = await supabase.rpc("stores_consumables_usage", { p_from: f.from, p_to: f.to });
      if (error) throw new Error(error.message);
      const rows = (data ?? []).filter((r) => !f.category || r.category_name === f.category);
      return {
        columns: [{ label: "Item" }, { label: "Category" }, { label: "Department" }, { label: "Quantity", align: "right" }, { label: "Unit" }, { label: "Issues", align: "right" }],
        rows: rows.map((r) => [r.item_name, r.category_name, r.department_name, Number(r.quantity), r.unit, Number(r.issues)]),
        summary: `${rows.length} lines from ${formatDate(f.from)} to ${formatDate(f.to)}.`,
      };
    }
    case "movements": {
      let q = supabase.from("v_stores_movements").select("*").gte("occurred_at", fromTs).lte("occurred_at", toTs).order("id", { ascending: false }).limit(10000);
      if (f.category) q = q.eq("category_id", f.category);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return {
        columns: [{ label: "Date" }, { label: "Reference" }, { label: "Movement" }, { label: "Item" }, { label: "Category" }, { label: "Quantity", align: "right" }, { label: "Shelf change", align: "right" }, { label: "Employee" }, { label: "Department" }, { label: "Condition" }, { label: "Recorded by" }, { label: "Notes" }],
        rows: (data ?? []).map((m) => [formatDateTime(m.occurred_at), m.reference, MOVEMENT_LABELS[m.movement_type as StoresMovementType], m.item_name, m.category_name, m.quantity, shelfChange(m.available_delta), m.employee_name, m.department_name, m.condition ? CONDITION_LABELS[m.condition as Condition] : null, m.recorded_by_name, m.notes]),
        summary: `${data?.length ?? 0} movements from ${formatDate(f.from)} to ${formatDate(f.to)}.`,
      };
    }
    case "low-stock": {
      let q = supabase.from("stores_items").select("name, unit, min_stock, qty_available, stores_categories!stores_items_category_id_fkey(name)").eq("is_active", true).eq("is_low_stock", true).order("qty_available").order("name").limit(10000);
      if (f.category) q = q.eq("category_id", f.category);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return {
        columns: [{ label: "Item" }, { label: "Category" }, { label: "On the shelf", align: "right" }, { label: "Reorder level", align: "right" }, { label: "Unit" }],
        rows: (data ?? []).map((i) => [i.name, one(i.stores_categories)?.name ?? null, i.qty_available, i.min_stock, i.unit]),
        summary: `${data?.length ?? 0} items at or under their reorder level.`,
      };
    }
    case "assigned": {
      const { data, error } = await supabase
        .from("stores_assignments")
        .select("reference, item_name, unit, quantity_held, department_name, employee_name, location_note, assigned_at, recorded_by_name")
        .eq("status", "active")
        .gte("assigned_at", fromTs)
        .lte("assigned_at", toTs)
        .order("department_name")
        .order("item_name")
        .limit(10000);
      if (error) throw new Error(error.message);
      return {
        columns: [{ label: "Item" }, { label: "Quantity", align: "right" }, { label: "Department" }, { label: "Responsible person" }, { label: "Location" }, { label: "Assigned" }, { label: "Recorded by" }, { label: "Reference" }],
        rows: (data ?? []).map((a) => [a.item_name, a.quantity_held, a.department_name, a.employee_name, a.location_note, formatDate(a.assigned_at), a.recorded_by_name, a.reference]),
        summary: `${(data ?? []).reduce((n, a) => n + a.quantity_held, 0)} units assigned.`,
      };
    }
    case "valuation": {
      let q = supabase.from("stores_items").select("name, unit, purchase_price_minor, qty_total, qty_available, stores_categories!stores_items_category_id_fkey(name)").eq("is_active", true).order("name").limit(10000);
      if (f.category) q = q.eq("category_id", f.category);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const priced = (data ?? []).filter((i) => i.purchase_price_minor !== null);
      const unpriced = (data ?? []).length - priced.length;
      const total = priced.reduce((n, i) => n + (i.purchase_price_minor ?? 0) * i.qty_total, 0);
      const shelf = priced.reduce((n, i) => n + (i.purchase_price_minor ?? 0) * i.qty_available, 0);
      return {
        columns: [{ label: "Item" }, { label: "Category" }, { label: "Price each", align: "right", money: true }, { label: "Owned", align: "right" }, { label: "Value owned", align: "right", money: true }, { label: "On the shelf", align: "right" }, { label: "Value on the shelf", align: "right", money: true }],
        rows: priced.map((i) => [i.name, one(i.stores_categories)?.name ?? null, i.purchase_price_minor, i.qty_total, (i.purchase_price_minor ?? 0) * i.qty_total, i.qty_available, (i.purchase_price_minor ?? 0) * i.qty_available]),
        footer: ["Total", null, null, null, total, null, shelf],
        summary: `${formatMoney(total, "BWP")} owned, ${formatMoney(shelf, "BWP")} on the shelf.${unpriced ? ` ${unpriced} ${unpriced === 1 ? "item has" : "items have"} no purchase price and ${unpriced === 1 ? "is" : "are"} not counted.` : ""}`,
      };
    }
  }
}

/** A cell as the page shows it. */
export function displayCell(c: Cell, col: Column): string {
  if (c === null || c === "") return "—";
  if (col.money && typeof c === "number") return formatMoney(c, "BWP");
  return String(c);
}

/** A cell as the download carries it: money in pula with two decimals, so a spreadsheet can add it up. */
export function exportCell(c: Cell, col: Column): Cell {
  if (col.money && typeof c === "number") return (c / 100).toFixed(2);
  return c;
}
