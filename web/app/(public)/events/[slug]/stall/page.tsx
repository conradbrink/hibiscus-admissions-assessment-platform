import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { StallForm } from "@/components/events/stall-form";
import { loadSaleEvent } from "@/lib/events/orders";
import { eventStillAhead, eventWhen } from "@/lib/events/pricing";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { bookStall } from "../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ cancelled?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sale = await loadSaleEvent(createAdminClient(), slug);
  if (!sale) return { title: "Book a stall" };
  const description = `Book a stall at ${sale.event.name}, ${eventWhen(sale.event, sale.sales.show_time)}.`;
  return { title: `Book a stall · ${sale.event.name}`, description, robots: { index: true, follow: false }, openGraph: { title: `Book a stall at ${sale.event.name}`, description } };
}

/** Booking and paying for a stall. The stall's tickets are issued with it. */
export default async function StallPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const sale = await loadSaleEvent(createAdminClient(), slug);
  if (!sale || sale.sales.stall_price_minor === null) notFound();
  const { event, sales, campus } = sale;
  const ahead = eventStillAhead(event, new Date());
  const open = ahead && sales.stalls_open;
  const staff = sales.stall_tickets - 1;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <Link href={`/events/${sales.slug}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {event.name}
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">Book a stall</h1>
      <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <CalendarDays className="size-4 shrink-0" aria-hidden /> {eventWhen(event, sales.show_time)}
        </li>
        <li className="flex items-center gap-2">
          <MapPin className="size-4 shrink-0" aria-hidden /> {event.location ?? campus.name}
        </li>
      </ul>

      <div className="mt-6 flex items-baseline justify-between gap-4 rounded-2xl bg-accent/60 px-5 py-4">
        <p className="text-sm leading-relaxed">
          One stall, with {sales.stall_tickets} tickets: one for you{staff > 0 ? ` and ${staff === 1 ? "one for a member of your staff" : `${staff} for your staff`}` : ""}.
        </p>
        <p className="text-2xl font-bold whitespace-nowrap tabular-nums">{formatMoney(sales.stall_price_minor ?? 0, campus.currency)}</p>
      </div>
      {sales.stall_intro ? <p className="mt-5 text-base leading-relaxed whitespace-pre-line text-pretty">{sales.stall_intro}</p> : null}

      <div className="surface mt-8 p-5 sm:p-7">
        {sp.cancelled ? (
          <p role="status" className="mb-6 rounded-xl bg-warning/20 px-4 py-3 text-sm text-warning-foreground">
            You came back without paying, so nothing was charged. You can try again below.
          </p>
        ) : null}
        {open ? (
          <StallForm action={bookStall.bind(null, sales.slug)} priceMinor={sales.stall_price_minor ?? 0} currency={campus.currency} stallTickets={sales.stall_tickets} />
        ) : (
          <p className="text-base">{event.is_cancelled ? "This event has been cancelled." : !ahead ? "This event has already taken place." : "Stall bookings are not open yet. Please come back soon."}</p>
        )}
      </div>
    </div>
  );
}
