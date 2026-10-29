import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Baby, CalendarDays, MapPin, Ticket } from "lucide-react";
import { Confetti } from "@/components/events/confetti";
import { Countdown } from "@/components/events/countdown";
import { TicketForm } from "@/components/events/ticket-form";
import { eventArtwork } from "@/lib/events/artwork";
import { loadSaleEvent } from "@/lib/events/orders";
import { earlyLastDay, eventStillAhead, eventWhen, ticketPriceAt } from "@/lib/events/pricing";
import { formatDateLong } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { buyTickets } from "./actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ cancelled?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sale = await loadSaleEvent(createAdminClient(), slug);
  if (!sale) return { title: "Event" };
  const art = eventArtwork(sale.sales.slug);
  const description = `${eventWhen(sale.event, sale.sales.show_time)} at ${sale.event.location ?? sale.campus.name}.${art ? ` With ${art.headliner.name}.` : ""} Buy your tickets online.`;
  // The link is mostly shared on WhatsApp, which shows this picture in the
  // chat. An absolute address, because there is no metadataBase to resolve
  // a relative one against.
  const images = art ? [{ url: `${siteUrl()}${art.headliner.photo.src}`, width: art.headliner.photo.width, height: art.headliner.photo.height, alt: art.headliner.name }] : undefined;
  // An event open to the public is meant to be found and shared, unlike
  // every other page here.
  return { title: sale.event.name, description, robots: { index: true, follow: false }, openGraph: { title: sale.event.name, description, images } };
}

/**
 * An event's page: what it is, when and where, what a ticket costs and until
 * when, and the form to buy them. Read first on a phone, from a link shared
 * on WhatsApp, by people who may know nothing about the school.
 *
 * Stalls are not on this page. The school chooses its traders and sends each
 * one the stall page's address (shown to staff on the event's Tickets page),
 * as the owner asked on 29 October 2026; a public "Book a stall" let anybody
 * who found the show buy one.
 */
export default async function EventPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const sale = await loadSaleEvent(createAdminClient(), slug);
  if (!sale) notFound();
  const { event, sales, campus } = sale;

  const now = new Date();
  const price = ticketPriceAt(sales, now);
  const ahead = eventStillAhead(event, now);
  const selling = ahead && sales.tickets_open;
  const when = eventWhen(event, sales.show_time);
  const place = event.location ?? campus.name;
  const lastEarlyDay = price.earlyEndsAt ? formatDateLong(earlyLastDay(price.earlyEndsAt)) : null;
  const laterFrom = price.earlyEndsAt ? formatDateLong(price.earlyEndsAt) : null;
  const art = eventArtwork(sales.slug);

  const closedReason = event.is_cancelled
    ? "This event has been cancelled."
    : !ahead
      ? "This event has already taken place. Thank you to everyone who came."
      : "Tickets are not on sale yet. Please come back soon.";

  // The price, as a ticket: what one costs now and how long that lasts.
  const priceTicket = (
    <div className="rounded-3xl bg-background p-5 text-foreground shadow-lift sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-muted-foreground">{price.name === "Early bird" ? "Early bird price" : `Price per ${sales.ticket_label.toLowerCase()}`}</p>
        <p className="text-3xl font-bold tracking-tight whitespace-nowrap tabular-nums">{formatMoney(price.unitMinor, campus.currency)}</p>
      </div>
      <div className="relative my-4 border-t-2 border-dashed border-border" aria-hidden>
        <span className="absolute -top-3 -left-8 size-6 rounded-full bg-foreground sm:-left-9" />
        <span className="absolute -top-3 -right-8 size-6 rounded-full bg-foreground sm:-right-9" />
      </div>
      {price.earlyEndsAt && selling ? (
        <>
          <p className="mb-3 text-sm">
            Until <strong>{lastEarlyDay}</strong>. After that,{" "}
            <span className="whitespace-nowrap">{formatMoney(price.laterMinor ?? sales.ticket_price_minor, campus.currency)}</span> per{" "}
            {sales.ticket_label.toLowerCase()}.
          </p>
          <Countdown until={price.earlyEndsAt.toISOString()} serverNow={now.toISOString()} />
        </>
      ) : (
        <p className="text-sm">
          {selling ? `Each ${sales.ticket_label.toLowerCase()} has one person's name on it.` : closedReason}
        </p>
      )}
    </div>
  );

  return (
    <>
      <section className="relative overflow-hidden bg-foreground text-background">
        {/* String lights: a row of warm dots along the top edge, nothing more. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-8 opacity-70 [background-image:radial-gradient(circle,#f26a2e_2.5px,transparent_3px),radial-gradient(circle,#ffd68a_2px,transparent_2.5px)] [background-position:0_10px,22px_18px] [background-size:44px_28px]"
        />
        {art?.confetti ? <Confetti /> : null}
        <div
          className={cn(
            "relative mx-auto grid max-w-4xl gap-8 px-4 pt-14 pb-10 sm:pt-16 md:items-center md:gap-10 md:pb-14",
            art ? "md:grid-cols-[minmax(0,1fr)_22rem]" : "md:grid-cols-[1.15fr_1fr]",
          )}
        >
          <div>
            <p className="text-sm font-semibold text-[#ffb27f]">{campus.name}</p>
            <h1 className="mt-2 text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">{event.name}</h1>
            {art ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-[#ffb27f]">Featuring</p>
                <p className="text-2xl font-bold tracking-tight sm:text-3xl">{art.headliner.name}</p>
                <p className="mt-2 text-base text-background/85">{art.billing}</p>
              </div>
            ) : null}
            <ul className="mt-6 space-y-2 text-base text-background/85">
              <li className="flex items-start gap-2.5">
                <CalendarDays className="mt-0.5 size-5 shrink-0 text-[#ffb27f]" aria-hidden />
                <span>{when}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-5 shrink-0 text-[#ffb27f]" aria-hidden />
                <span>{place}</span>
              </li>
              {art?.freeEntry ? (
                <li className="flex items-start gap-2.5">
                  <Baby className="mt-0.5 size-5 shrink-0 text-[#ffb27f]" aria-hidden />
                  <span>{art.freeEntry.note}</span>
                </li>
              ) : null}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              {selling ? (
                <a href="#tickets" className="inline-flex h-12 items-center gap-2 rounded-xl bg-background px-5 text-base font-semibold text-foreground transition-transform active:scale-[0.98]">
                  <Ticket className="size-5" aria-hidden /> Buy tickets
                </a>
              ) : null}
            </div>
          </div>

          {art ? (
            <div className="relative mx-auto w-full max-w-sm md:mx-0 md:max-w-none">
              <Image
                src={art.headliner.photo.src}
                width={art.headliner.photo.width}
                height={art.headliner.photo.height}
                alt={art.headliner.name}
                priority
                sizes="(min-width: 768px) 22rem, 24rem"
                className="h-auto w-full rounded-3xl ring-1 ring-background/15"
              />
              {/* Overlapping the photo by less than the height of the price line, so the ticket's notches fall on the dark background and not on the picture. */}
              <div className="relative mx-2 -mt-12 sm:mx-4 md:mr-4 md:-ml-8">{priceTicket}</div>
            </div>
          ) : (
            priceTicket
          )}
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <div className="grid gap-10 md:grid-cols-[1fr_1.35fr] md:gap-12">
          <aside className="space-y-8">
            {sales.intro ? <p className="text-base leading-relaxed whitespace-pre-line text-pretty">{sales.intro}</p> : null}

            <section>
              <h2 className="text-lg font-semibold">Prices</h2>
              <dl className="mt-3 divide-y divide-border/70 rounded-2xl border border-border/70 bg-card text-sm">
                {sales.early_price_minor !== null && sales.early_until ? (
                  <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt>
                      Early bird
                      <span className="block text-xs text-muted-foreground">Until {formatDateLong(earlyLastDay(new Date(sales.early_until)))}</span>
                    </dt>
                    <dd className="font-semibold tabular-nums">{formatMoney(sales.early_price_minor, campus.currency)}</dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <dt>
                    {sales.early_until ? "Standard" : sales.ticket_label}
                    {laterFrom ? <span className="block text-xs text-muted-foreground">From {laterFrom}</span> : null}
                  </dt>
                  <dd className="font-semibold tabular-nums">{formatMoney(sales.ticket_price_minor, campus.currency)}</dd>
                </div>
                {art?.freeEntry ? (
                  <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt>{art.freeEntry.who}</dt>
                    <dd className="font-semibold">Free</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section>
              <h2 className="text-lg font-semibold">How it works</h2>
              <ol className="mt-3 space-y-3 text-sm leading-relaxed">
                {[
                  "Choose how many tickets you need, and type each person's name.",
                  "Pay online on the school's secure payment page.",
                  "We email your tickets. Each one has its own number and the person's name.",
                  "Bring a copy of each ticket to the gate, printed or on your phone.",
                ].map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          </aside>

          <section id="tickets" className="scroll-mt-6">
            <div className="surface p-5 sm:p-7">
              <h2 className="text-2xl font-bold tracking-tight">Buy tickets</h2>
              {sp.cancelled ? (
                <p role="status" className="mt-3 rounded-xl bg-warning/20 px-4 py-3 text-sm text-warning-foreground">
                  You came back without paying, so nothing was charged. You can try again below.
                </p>
              ) : null}
              <div className="mt-6">
                {selling ? (
                  <TicketForm
                    action={buyTickets.bind(null, sales.slug)}
                    maxTickets={sales.max_tickets_per_order}
                    unitMinor={price.unitMinor}
                    currency={campus.currency}
                    ticketLabel={sales.ticket_label}
                  />
                ) : (
                  <p className="text-base">{closedReason}</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
