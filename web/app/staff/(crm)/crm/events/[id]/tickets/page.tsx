import { notFound } from "next/navigation";
import { Download, ExternalLink, ScanLine, Store, Ticket, Wallet } from "lucide-react";
import { CheckInForm } from "@/components/events/check-in-form";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { lastDayFromEarlyUntil } from "@/lib/events/sales-form";
import { formatDateTime, formatTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { EventOrderRow, EventSalesRow, EventTicketRow } from "@/lib/supabase/types";
import { siteUrl } from "@/lib/tokens";
import { checkInTicket, resendTickets, saveSales, undoCheckIn } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));

const ORDER_BADGE: Record<EventOrderRow["status"], { label: string; variant: "success" | "warning" | "muted" }> = {
  paid: { label: "Paid", variant: "success" },
  pending: { label: "Paying", variant: "warning" },
  cancelled: { label: "Not paid", variant: "muted" },
};

/**
 * Tickets and stalls for one event: the prices and the switches, who has
 * bought, the gate, and the list to download.
 *
 * Everything is read through the signed-in person's own client, so the
 * orders and tickets are those at a campus they may see. The money itself is
 * on the payments page, where finance looks for it.
 */
export default async function EventTicketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.write");
  const canExport = can(permissions, "crm.export");

  const { data: event } = await supabase.from("crm_events").select("id, name, starts_at, campus_id, campuses(name, currency)").eq("id", id).maybeSingle();
  if (!event) notFound();
  const campus = one(event.campuses);
  const currency = campus?.currency ?? "BWP";

  const [{ data: sales }, { data: orders }, { data: tickets }] = await Promise.all([
    supabase.from("event_sales").select("*").eq("event_id", id).maybeSingle(),
    supabase.from("event_orders").select("*").eq("event_id", id).order("created_at", { ascending: false }).limit(2000),
    supabase.from("event_tickets").select("*").eq("event_id", id).order("number").limit(10000),
  ]);

  const ticketsByOrder = new Map<string, EventTicketRow[]>();
  for (const t of tickets ?? []) ticketsByOrder.set(t.order_id, [...(ticketsByOrder.get(t.order_id) ?? []), t]);
  const paid = (orders ?? []).filter((o) => o.status === "paid");
  const takenMinor = paid.reduce((sum, o) => sum + Number(o.amount_minor), 0);
  const stallsPaid = paid.filter((o) => o.kind === "stall").length;
  const checkedIn = (tickets ?? []).filter((t) => t.checked_in_at).length;
  const visible = (orders ?? []).filter((o) => o.status !== "cancelled" || ticketsByOrder.has(o.id));
  const notPaid = (orders ?? []).length - visible.length;
  const publicUrl = sales ? `${siteUrl()}/events/${sales.slug}` : null;

  return (
    <>
      <PageTitle back={{ href: `/staff/crm/events/${id}`, label: event.name }} title="Tickets and stalls" description={`${event.name} · ${campus?.name ?? "No campus"}. Prices, who has bought, and the gate.`}>
        {publicUrl ? (
          <a href={publicUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "lg" })}>
            <ExternalLink data-icon="inline-start" /> Public page
          </a>
        ) : null}
        {sales && canExport ? (
          <a href={`/staff/crm/events/${id}/tickets/export`} className={buttonVariants({ size: "lg" })}>
            <Download data-icon="inline-start" /> Download the list
          </a>
        ) : null}
      </PageTitle>

      {sales ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Tickets sold" value={(tickets ?? []).length} icon={Ticket} hint={`${paid.length} paid orders`} />
          <StatTile label="Checked in" value={checkedIn} icon={ScanLine} tone="success" />
          <StatTile label="Stalls booked" value={stallsPaid} icon={Store} hint={sales.stall_capacity ? `of ${sales.stall_capacity}` : undefined} />
          <StatTile label="Taken online" value={formatMoney(takenMinor, currency)} icon={Wallet} />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="surface min-w-0">
          <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
            <h2 className="font-semibold">Orders</h2>
            {notPaid ? <p className="text-xs text-muted-foreground">{notPaid === 1 ? "1 checkout that was never paid is not shown." : `${notPaid} checkouts that were never paid are not shown.`}</p> : null}
          </div>
          {visible.length ? (
            <ul className="divide-y divide-border/70">
              {visible.map((o) => {
                const its = ticketsByOrder.get(o.id) ?? [];
                const badge = ORDER_BADGE[o.status];
                return (
                  <li key={o.id} className="px-5 py-3.5 text-sm">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {o.buyer_first_name} {o.buyer_last_name}
                          {o.kind === "stall" ? <span className="text-muted-foreground"> · Stall: {o.business_name}</span> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {o.reference} · {o.email}
                          {o.mobile ? ` · ${o.mobile}` : ""} · {formatDateTime(o.created_at)}
                        </p>
                        {o.kind === "stall" && (o.stall_goods || o.needs_power) ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {o.stall_goods ?? ""}
                            {o.needs_power ? `${o.stall_goods ? " · " : ""}Needs electricity` : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums">{formatMoney(Number(o.amount_minor), o.currency)}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                    </div>
                    {its.length ? (
                      <ul className="mt-2 space-y-1 rounded-xl bg-muted/50 px-3 py-2">
                        {its.map((t) => (
                          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="font-mono font-semibold">{t.number}</span>
                            <span>
                              {t.holder_first_name} {t.holder_last_name}
                            </span>
                            <span className="text-muted-foreground">{t.label}</span>
                            {t.checked_in_at ? (
                              <span className="ml-auto flex items-center gap-2 text-success">
                                In at {formatTime(t.checked_in_at)}
                                {canWrite ? (
                                  <ActionForm action={undoCheckIn} label="Undo" size="xs" variant="ghost" className="space-y-0" confirm={`Mark ${t.number} as not used?`}>
                                    <input type="hidden" name="eventId" value={id} />
                                    <input type="hidden" name="ticketId" value={t.id} />
                                  </ActionForm>
                                ) : null}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {o.status === "paid" && canWrite ? (
                      <ActionForm action={resendTickets} label="Email the tickets again" size="xs" variant="outline" className="mt-2 space-y-1" confirm={`Send the tickets for ${o.reference} to ${o.email} again?`}>
                        <input type="hidden" name="eventId" value={id} />
                        <input type="hidden" name="orderId" value={o.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 pb-5">
              <EmptyState>{sales ? "No orders yet." : "This event is not selling tickets."}</EmptyState>
            </div>
          )}
        </section>

        <div className="space-y-5">
          {sales && canWrite ? (
            <section className="surface p-4">
              <h2 className="text-sm font-semibold">At the gate</h2>
              <p className="mb-3 text-xs text-muted-foreground">Type the number on the ticket, or scan its code with the phone&rsquo;s camera and paste the number. Each number lets one person in, once.</p>
              <CheckInForm eventId={id} action={checkInTicket} />
            </section>
          ) : null}

          {publicUrl ? (
            <section className="surface p-4 text-sm">
              <h2 className="text-sm font-semibold">Links to share</h2>
              <p className="mt-2 text-xs text-muted-foreground">Tickets</p>
              <p className="font-mono text-xs break-all">{publicUrl}</p>
              {sales?.stall_price_minor !== null ? (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">Stalls</p>
                  <p className="font-mono text-xs break-all">{publicUrl}/stall</p>
                </>
              ) : null}
            </section>
          ) : null}

          {canWrite ? (
            <SalesForm eventId={id} sales={sales} currency={currency} hasCampus={Boolean(event.campus_id)} />
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Prices and switches. Shown to whoever may change them; the rest see the page without it. */
function SalesForm({ eventId, sales, currency, hasCampus }: { eventId: string; sales: EventSalesRow | null; currency: string; hasCampus: boolean }) {
  const symbol = currency === "ZAR" ? "R" : "P";
  const label = (text: string) => <span className="mb-1 block text-muted-foreground">{text}</span>;
  return (
    <section className="surface p-4">
      <h2 className="text-sm font-semibold">{sales ? "Prices and sales" : "Sell tickets for this event"}</h2>
      {!hasCampus ? <p className="mt-1 text-xs text-destructive">Choose a campus for the event first. The campus decides the currency and who sees the money.</p> : null}
      <ActionForm action={saveSales} label={sales ? "Save" : "Start selling"} size="lg" resetOnSubmit={false} className="mt-3 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-2">
        <input type="hidden" name="eventId" value={eventId} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="ticketsOpen" defaultChecked={sales?.tickets_open ?? false} /> Tickets on sale
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="stallsOpen" defaultChecked={sales?.stalls_open ?? false} /> Stall bookings open
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="showTime" defaultChecked={sales?.show_time ?? true} /> Show the event&rsquo;s start time on the public page
        </label>
        <label className="sm:col-span-2">
          {label("Web address")}
          <Input name="slug" defaultValue={sales?.slug ?? ""} placeholder="christmas-show" required />
        </label>
        <label>
          {label(`Ticket price (${symbol})`)}
          <Input name="ticketPrice" inputMode="decimal" defaultValue={money(sales?.ticket_price_minor)} required />
        </label>
        <label>
          {label("Tickets per order, at most")}
          <Input name="maxTickets" inputMode="numeric" defaultValue={sales?.max_tickets_per_order ?? 10} required />
        </label>
        <label>
          {label(`Early-bird price (${symbol})`)}
          <Input name="earlyPrice" inputMode="decimal" defaultValue={money(sales?.early_price_minor)} placeholder="None" />
        </label>
        <label>
          {label("Early bird's last day")}
          <Input name="earlyLastDay" type="date" defaultValue={lastDayFromEarlyUntil(sales?.early_until ?? null)} />
        </label>
        <label>
          {label(`Stall price (${symbol})`)}
          <Input name="stallPrice" inputMode="decimal" defaultValue={money(sales?.stall_price_minor)} placeholder="No stalls" />
        </label>
        <label>
          {label("Tickets with each stall")}
          <Input name="stallTickets" inputMode="numeric" defaultValue={sales?.stall_tickets ?? 2} required />
        </label>
        <label>
          {label("Number of stalls")}
          <Input name="stallCapacity" inputMode="numeric" defaultValue={sales?.stall_capacity ?? ""} placeholder="No limit" />
        </label>
        <label>
          {label("Ticket number prefix")}
          <Input name="ticketPrefix" defaultValue={sales?.ticket_prefix ?? ""} placeholder="HCS" className="uppercase" required />
        </label>
        <label className="sm:col-span-2">
          {label("What one ticket is called")}
          <Input name="ticketLabel" defaultValue={sales?.ticket_label ?? "Ticket"} maxLength={40} />
        </label>
        <label className="sm:col-span-2">
          {label("Words on the ticket page (the public reads this)")}
          <Textarea name="intro" rows={4} defaultValue={sales?.intro ?? ""} maxLength={4000} />
        </label>
        <label className="sm:col-span-2">
          {label("Words on the stall page")}
          <Textarea name="stallIntro" rows={3} defaultValue={sales?.stall_intro ?? ""} maxLength={4000} />
        </label>
        <p className="text-muted-foreground sm:col-span-2">
          The event&rsquo;s name, date, time, place and capacity are on the event itself. Capacity counts every ticket sold, stall tickets included. A price change applies to new orders only.
        </p>
      </ActionForm>
    </section>
  );
}
