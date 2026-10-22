import { toCsv } from "@/lib/crm/csv";
import { safeCell } from "@/lib/events/sales-form";
import { can } from "@/lib/permissions";
import { getStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every ticket for one event, one row each, with the order behind it: the
 * gate list, and the sheet the school asked for. It opens in Google Sheets or
 * Excel as it is. Read through the caller's own client, so the rows are the
 * ones their campus may see, and audited like the CRM's other exports.
 *
 * Names and stall details were typed by the public, so a cell that would
 * start a formula is written as text (`safeCell`).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const staff = await getStaff();
  if (!staff || !can(staff.permissions, "crm.export")) return new Response("Forbidden", { status: 403 });
  const { supabase } = staff;

  const { data: event } = await supabase.from("crm_events").select("id, name").eq("id", id).maybeSingle();
  if (!event) return new Response("Not found", { status: 404 });
  const [{ data: tickets }, { data: orders }] = await Promise.all([
    supabase.from("event_tickets").select("*").eq("event_id", id).order("number").limit(20000),
    supabase.from("event_orders").select("*").eq("event_id", id).eq("status", "paid").limit(20000),
  ]);
  const byId = new Map((orders ?? []).map((o) => [o.id, o]));

  const headers = [
    "ticket_number", "ticket", "first_name", "last_name", "checked_in_at",
    "order_reference", "order_kind", "price", "currency", "paid_at",
    "buyer_first_name", "buyer_last_name", "buyer_email", "buyer_mobile",
    "stall_name", "stall_sells", "stall_needs_electricity",
  ];
  const rows = (tickets ?? []).map((t) => {
    const o = byId.get(t.order_id);
    return [
      t.number, t.label, safeCell(t.holder_first_name), safeCell(t.holder_last_name), t.checked_in_at,
      o?.reference, o?.kind, o ? Number(o.unit_amount_minor) / 100 : null, o?.currency, o?.paid_at,
      safeCell(o?.buyer_first_name), safeCell(o?.buyer_last_name), safeCell(o?.email), o?.mobile,
      safeCell(o?.business_name), safeCell(o?.stall_goods), o?.kind === "stall" ? (o.needs_power ? "yes" : "no") : null,
    ];
  });

  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: staff.userId,
    actor_label: staff.profile.email,
    action: "crm.export",
    entity_type: "export",
    after: { kind: "event_tickets", event_id: id, rows: rows.length },
  });

  const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "event";
  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tickets-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
