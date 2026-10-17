import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Download } from "lucide-react";
import { PageHeader } from "@/components/parent/page-header";
import { CheckPaymentButton, PayOnlineButton } from "@/components/parent/pay-buttons";
import { Button } from "@/components/ui/button";
import { formatDateLong, formatDateRange } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { lateAttemptOf } from "@/lib/payments/attempts";
import { canPayOnline, transferOnlyReason } from "@/lib/payments/online";
import { paymentProviderName } from "@/lib/payments/provider";
import { getSettings } from "@/lib/settings";
import { requireTransportSession } from "@/lib/tokens/server";
import { HOUSEHOLD_LABELS, SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import { loadSessionBooking, transportClient } from "@/lib/transport/scope";
import { checkTransportPayment, startTransportPayment } from "./actions";

export const metadata: Metadata = { title: "Your school transport booking" };
export const dynamic = "force-dynamic";

/**
 * The booking, priced, and the Pay button.
 *
 * Every figure here is the database's: each child's line as the booking
 * function wrote it, and the request's total. The estimate on the form was
 * only that.
 */
export default async function TransportBookingPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const sp = await searchParams;
  const session = await requireTransportSession();
  const admin = transportClient();
  const loaded = await loadSessionBooking(admin, session);
  if (!loaded) redirect("/transport?expired=1");
  const settings = await getSettings(admin);

  const { booking, period, area, riders, request, payments } = loaded;
  const booked = riders.filter((r) => r.status === "booked");
  const total = request ? Number(request.amount_minor) : booked.reduce((s, r) => s + Number(r.amount_minor), 0);
  const paidMinor = request ? Number(request.paid_minor) : 0;
  const settled = booking.status === "paid";
  const processing = payments.find((p) => p.status === "processing") ?? null;
  const lastFailed = payments.find((p) => p.status === "failed" || p.status === "expired") ?? null;
  const lateCheck = lateAttemptOf(payments) !== null;
  const canPay = booking.status === "awaiting_payment" && (!request || ["required", "failed", "partially_paid"].includes(request.status));
  const contact = settings.transportOfficeContact || "the school office";

  return (
    <>
      <PageHeader
        eyebrow={`School transport · ${booking.reference}`}
        title={settled ? "Your booking is paid" : "Check your booking, then pay"}
        description={
          period
            ? `${period.label}, ${formatDateRange(period.starts_on, period.ends_on)}. Collected from ${area?.name ?? "your area"}.`
            : undefined
        }
      />

      {settled ? (
        <section className="rounded-2xl bg-success/10 p-5 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> Paid
            {booking.paid_at ? ` on ${formatDateLong(booking.paid_at)}` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            We have sent the receipt to {booking.email}. The transport provider will contact you before the first day.
          </p>
          <div className="mt-4">
            <Button size="parent" variant="outline" nativeButton={false} render={<Link href="/transport/booking/receipt" prefetch={false} />}>
              <Download data-icon="inline-start" /> Download the receipt
            </Button>
          </div>
        </section>
      ) : null}

      {booking.status === "expired" || booking.status === "abandoned" || booking.status === "cancelled" ? (
        <section className="rounded-2xl bg-muted p-5 text-sm" role="status">
          <p className="font-semibold">This booking is closed.</p>
          <p className="mt-1 text-muted-foreground">
            {booking.status === "cancelled"
              ? `It was cancelled. If you have questions, please contact ${contact}.`
              : "It was not paid in time. Please book again."}
          </p>
          {booking.status !== "cancelled" ? (
            <div className="mt-4">
              <Button size="parent" nativeButton={false} render={<Link href="/transport/book" />}>
                Book again
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-5 surface p-5 text-sm">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your children (BWP)</p>
        <ul className="mt-2 divide-y divide-border">
          {riders.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex justify-between gap-3">
                <span className="font-medium">
                  {r.first_name} {r.last_name}
                  {r.status === "cancelled" ? <span className="ml-2 text-xs text-muted-foreground">(cancelled)</span> : null}
                </span>
                <span className="tabular-nums">{formatMoney(Number(r.amount_minor), "BWP")}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {r.campus?.name}
                {r.grade ? `, ${r.grade.name}` : ""}. {SERVICE_LABELS[r.service]}, {weekdaysLabel(r)}. {HOUSEHOLD_LABELS[r.household]} price.
              </p>
            </li>
          ))}
          <li className="flex justify-between py-3 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(total, "BWP")}</span>
          </li>
          {paidMinor > 0 && !settled ? (
            <li className="flex justify-between py-2">
              <span>Received so far</span>
              <span className="tabular-nums">{formatMoney(paidMinor, "BWP")}</span>
            </li>
          ) : null}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Prices include VAT. Collected from: {booking.address_line}
          {booking.landmark ? ` (${booking.landmark})` : ""}.
        </p>
        {request && !settled && canPay ? (
          <p className="mt-2 text-xs text-muted-foreground">Please pay by {formatDateLong(request.due_at)}, or the booking closes.</p>
        ) : null}
      </section>

      {sp.cancelled && !settled ? (
        <p className="mt-4 text-sm text-muted-foreground">You came back without paying. Nothing has been charged, and the booking is still here.</p>
      ) : null}

      {lastFailed && !processing && !settled && canPay ? (
        lateCheck ? (
          <section className="mt-4 rounded-2xl bg-warning/20 p-4 text-sm">
            <p>
              We did not get confirmation of your last payment in time. If you finished paying on the provider&rsquo;s page, check again
              before paying twice. Otherwise you can try again below.
            </p>
            <div className="mt-3">
              <CheckPaymentButton action={checkTransportPayment} />
            </div>
          </section>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">The last attempt did not go through. You can try again below.</p>
        )
      ) : null}

      {processing && !settled ? (
        <section className="mt-5 surface p-5 text-sm">
          <p className="font-semibold">We are confirming your payment</p>
          <p className="mt-1 text-muted-foreground">This usually takes a moment. You can close this page — we confirm it either way — or check now.</p>
          <div className="mt-4">
            <CheckPaymentButton action={checkTransportPayment} />
          </div>
        </section>
      ) : canPay && total - paidMinor > 0 ? (
        canPayOnline(paymentProviderName(), "BWP") ? (
          <section className="mt-5">
            <PayOnlineButton action={startTransportPayment} label={`Pay ${formatMoney(total - paidMinor, "BWP")}`} />
            <p className="mt-3 text-xs text-muted-foreground">
              You will go to the payment provider&rsquo;s own secure page. We never see or store your card details. Your booking reference
              is <strong>{booking.reference}</strong>.
            </p>
          </section>
        ) : (
          <section className="mt-5 surface p-5 text-sm">
            <p className="font-semibold">Online payment is not available</p>
            <p className="mt-1 text-muted-foreground">{transferOnlyReason("BWP")}</p>
            <p className="mt-2">Please contact {contact} and quote {booking.reference}.</p>
          </section>
        )
      ) : null}
    </>
  );
}
