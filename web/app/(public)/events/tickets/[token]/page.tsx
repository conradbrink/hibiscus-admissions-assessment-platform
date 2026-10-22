import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CalendarDays, CheckCircle2, MapPin } from "lucide-react";
import { CheckPaymentButton } from "@/components/parent/pay-buttons";
import { PrintButton } from "@/components/events/print-button";
import { buttonVariants } from "@/components/ui/button";
import { loadOrderByToken, orderTotal } from "@/lib/events/orders";
import { eventWhen } from "@/lib/events/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkOrderPayment } from "./actions";

export const metadata: Metadata = { title: "Your tickets", referrer: "no-referrer" };

/**
 * One order's tickets, opened from the email or straight after paying.
 *
 * The link is the ticket: a bearer link to this one order, like the email it
 * came in. So the page shows what the gate needs — number, name, event — and
 * nothing more: no email address, no phone number. Printed, each ticket sits
 * on the page whole.
 */
export default async function TicketsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadOrderByToken(createAdminClient(), token);
  if (!view) notFound();
  const { order, tickets, event, sales } = view;
  const when = eventWhen(event, sales.show_time);
  const place = event.location ?? view.campusName;

  if (order.status !== "paid" || tickets.length === 0) {
    const cancelled = order.status === "cancelled";
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <p className="text-sm font-semibold text-primary">{event.name}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{cancelled ? "This order was not paid" : "We are confirming your payment"}</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {cancelled
            ? "The payment did not go through, so nothing was charged and no tickets were issued. If you did pay, check again: a payment can take a few minutes to reach us."
            : "This usually takes a moment. You can close this page: we email your tickets as soon as the payment is confirmed."}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Order {order.reference} · {orderTotal(order)}
        </p>
        <div className="mt-6 space-y-3">
          <CheckPaymentButton action={checkOrderPayment.bind(null, token)} />
          {cancelled ? (
            <Link href={`/events/${sales.slug}${order.kind === "stall" ? "/stall" : ""}`} className={buttonVariants({ size: "parent" })}>
              {order.kind === "stall" ? "Book again" : "Buy tickets again"}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const codes = await Promise.all(tickets.map((t) => QRCode.toDataURL(t.number, { margin: 1, width: 176 })));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12 print:max-w-none print:p-0">
      <div className="print:hidden">
        <p className="flex items-center gap-2 text-sm font-semibold text-success">
          <CheckCircle2 className="size-4" aria-hidden /> Paid · {orderTotal(order)}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Your tickets</h1>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          {tickets.length === 1 ? "Here is your ticket" : `Here are your ${tickets.length} tickets`} for {event.name}
          {order.kind === "stall" && order.business_name ? `, with your stall for ${order.business_name}` : ""}. Bring a copy of each ticket to the gate:
          printed, or on your phone. Each number lets one person in, once.
        </p>
        <div className="mt-5">
          <PrintButton />
        </div>
      </div>

      <ol className="mt-8 space-y-4 print:mt-0 print:space-y-3">
        {tickets.map((t, i) => (
          <li key={t.id} className="break-inside-avoid overflow-hidden rounded-2xl border border-border bg-card shadow-soft print:shadow-none">
            <div className="flex items-center justify-between gap-3 bg-foreground px-5 py-3 text-background print:[print-color-adjust:exact]">
              <p className="text-sm font-semibold">{event.name}</p>
              <p className="text-xs font-medium tracking-wide text-background/80 uppercase">{t.label}</p>
            </div>
            <div className="flex items-center gap-5 p-5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Name</p>
                <p className="text-xl font-bold tracking-tight">
                  {t.holder_first_name} {t.holder_last_name}
                </p>
                <p className="mt-3 text-xs font-medium text-muted-foreground">Ticket number</p>
                <p className="font-mono text-lg font-semibold tracking-wider">{t.number}</p>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden /> {when}
                  </li>
                  <li className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {place}
                  </li>
                </ul>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated on the server; next/image adds nothing and needs a width it cannot know */}
              <img src={codes[i]} alt={`QR code for ticket ${t.number}`} className="size-28 shrink-0 rounded-md bg-white sm:size-32" />
            </div>
            <p className="border-t border-dashed border-border px-5 py-2.5 text-xs text-muted-foreground">
              Order {order.reference} · {sales.ticket_label} {i + 1} of {tickets.length} · One person, once
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
