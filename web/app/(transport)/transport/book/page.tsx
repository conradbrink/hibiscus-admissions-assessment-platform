import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/parent/page-header";
import { TransportBookingForm, type TransportFormCatalogue } from "@/components/parent/transport-booking-form";
import { formatDateLong, formatDateRange } from "@/lib/format-date";
import { loadBookingCatalogue } from "@/lib/transport/catalogue";
import { customerTariffs } from "@/lib/transport/pricing";
import { transportClient } from "@/lib/transport/scope";
import { submitTransportBooking } from "./actions";

export const metadata: Metadata = { title: "Book school transport" };
export const dynamic = "force-dynamic";

/**
 * The booking form. Only what the form needs crosses to the browser: the
 * periods, areas, schools and grades, the terms, and the parent's prices.
 * The provider's own prices stay on the server (`customerTariffs`).
 */
export default async function BookTransportPage() {
  const catalogue = await loadBookingCatalogue(transportClient());
  if (catalogue.closedBecause.length > 0 || !catalogue.terms) redirect("/transport");

  const forForm: TransportFormCatalogue = {
    periods: catalogue.periods.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      divisor: p.divisor,
      price_list_id: p.price_list_id,
      dates: formatDateRange(p.starts_on, p.ends_on),
      closes: formatDateLong(p.booking_closes_on),
    })),
    areas: catalogue.areas.map((a) => ({ id: a.id, name: a.name, zone_id: a.zone_id })),
    campuses: catalogue.campuses,
    tariffs: catalogue.tariffs.map((t) => ({ ...customerTariffs([t])[0], price_list_id: t.price_list_id })),
    terms: catalogue.terms,
    officeContact: catalogue.officeContact,
  };

  return (
    <>
      <PageHeader
        eyebrow="School transport"
        title="Book school transport"
        description="It takes about five minutes. You see the exact price before you pay."
      />
      <TransportBookingForm catalogue={forForm} action={submitTransportBooking} />
    </>
  );
}
