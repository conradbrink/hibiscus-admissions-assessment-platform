import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bus } from "lucide-react";
import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";
import { formatDateLong, formatDateRange } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { loadBookingCatalogue } from "@/lib/transport/catalogue";
import { HOUSEHOLD_LABELS } from "@/lib/transport/days";
import { estimateCustomerTotal } from "@/lib/transport/pricing";
import { transportClient } from "@/lib/transport/scope";

export const metadata: Metadata = { title: "School transport" };
// Prices, periods and the on/off switch are read on every request. Built
// once, this page would show the prices and dates of the day it was deployed.
export const dynamic = "force-dynamic";

const HOUSEHOLDS = ["single", "same_school", "different_schools"] as const;

/**
 * The front door for school transport: what it costs, what can be booked
 * now, and the button. Public, like `/join`.
 */
export default async function TransportPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const sp = await searchParams;
  const catalogue = await loadBookingCatalogue(transportClient());
  const open = catalogue.closedBecause.length === 0;

  // The price table is for the price list the open periods use; with nothing
  // open there is nothing to price, and the page says when to come back.
  const firstTerm = catalogue.periods.find((p) => p.kind === "term") ?? catalogue.periods[0] ?? null;
  const months = firstTerm?.billing_months ?? 3;
  const tariffs = firstTerm ? catalogue.tariffs.filter((t) => t.price_list_id === firstTerm.price_list_id) : [];
  const price = (zoneId: string, service: "full" | "am", household: (typeof HOUSEHOLDS)[number], divisor: number) => {
    const riders =
      household === "single"
        ? [{ campusId: "a", service, days: 5 }]
        : household === "same_school"
          ? [{ campusId: "a", service, days: 5 }, { campusId: "a", service, days: 5 }]
          : [{ campusId: "a", service, days: 5 }, { campusId: "b", service, days: 5 }];
    const estimate = estimateCustomerTotal({ zoneId, divisor, tariffs, riders });
    return estimate ? estimate.lines[0].amountMinor : null;
  };

  return (
    <>
      <PageHeader
        eyebrow="School transport"
        title="A ride to school and back home"
        description={`${catalogue.providerName ?? "Our transport partner"} drives children between home and the Hibiscus schools in Gaborone. You can book for a term or for one month, and pay online.`}
      />

      {sp.expired ? (
        <section className="mb-5 rounded-2xl bg-warning/20 p-4 text-sm" role="status">
          <p>Your booking page timed out. If you paid, the receipt is in your email. If you did not pay, please book again.</p>
        </section>
      ) : null}

      <section className="surface p-5 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <Bus className="size-4 text-primary" aria-hidden /> How it works
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>Choose the days your child rides, and whether they ride in the morning, the afternoon, or both.</li>
          <li>You pay only for the days you choose. Three days a week costs three fifths of the full price.</li>
          <li>Children from one family pay less. The price is lower again when they go to the same school.</li>
          <li>You pay for a whole term, or for one month at a time.</li>
        </ul>
      </section>

      {open ? (
        <section className="mt-5">
          <p className="text-sm font-semibold">You can book now for:</p>
          <ul className="mt-2 space-y-1 text-sm">
            {catalogue.periods.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.label}</span>{" "}
                <span className="text-muted-foreground">
                  ({formatDateRange(p.starts_on, p.ends_on)}). Book by {formatDateLong(p.booking_closes_on)}.
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <Button size="parent" nativeButton={false} render={<Link href="/transport/book" />}>
              Book school transport <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </section>
      ) : (
        <section className="mt-5 rounded-2xl bg-muted p-5 text-sm" role="status">
          <p className="font-semibold">Booking is not open yet.</p>
          <p className="mt-1 text-muted-foreground">
            {catalogue.officeContact
              ? `Please check again soon, or contact ${catalogue.officeContact}.`
              : "Please check again soon, or contact the school office."}
          </p>
        </section>
      )}

      {tariffs.length > 0 ? (
        <section className="mt-8 space-y-6">
          <div>
            <h2 className="text-lg font-bold">Prices</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              For each child, five days a week, including VAT. A month is a third of the term price.
            </p>
          </div>
          {catalogue.zones.map((zone) => (
            <div key={zone.id} className="surface p-5 text-sm">
              <p className="font-semibold">{zone.label}</p>
              {(["full", "am"] as const).map((service) => (
                <div key={service} className="mt-3">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {service === "full" ? "Morning and afternoon" : "Morning only, or afternoon only"}
                  </p>
                  <table className="mt-1 w-full">
                    <thead className="sr-only">
                      <tr>
                        <th>Family</th>
                        <th>Per term</th>
                        <th>Per month</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {HOUSEHOLDS.map((h) => {
                        const term = price(zone.id, service, h, 1);
                        const month = price(zone.id, service, h, months);
                        if (term === null || month === null) return null;
                        return (
                          <tr key={h}>
                            <td className="py-1.5 pr-2">{HOUSEHOLD_LABELS[h]}</td>
                            <td className="py-1.5 text-right tabular-nums">{formatMoney(term, "BWP")}</td>
                            <td className="py-1.5 pl-3 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                              {formatMoney(month, "BWP")} a month
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            The price is per child. Which column applies depends on the area you live in, which you choose when you book.
          </p>
        </section>
      ) : null}
    </>
  );
}
