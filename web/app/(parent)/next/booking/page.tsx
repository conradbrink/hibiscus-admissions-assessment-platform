import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { BookingCard } from "@/components/parent/booking-card";
import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { hasStarted } from "@/lib/format-date";
import { requireParentSession } from "@/lib/tokens/server";
import { cancelBooking } from "../actions";

export const metadata: Metadata = { title: "Your booking" };

export default async function BookingPage() {
  const session = await requireParentSession();
  const graph = await loadApplicationGraph(createAdminClient(), session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  if (!graph.booking) redirect("/next");

  const { application: app, campus, booking } = graph;
  const qr = await QRCode.toDataURL(app.reference, { margin: 1, width: 192 });
  const past = hasStarted(booking.session.starts_at);

  return (
    <>
      <PageHeader title="Your booking" />
      <BookingCard
        kind={booking.kind}
        startsAt={booking.session.starts_at}
        campusName={campus.name}
        location={booking.session.location}
        reference={app.reference}
        qrDataUrl={qr}
      />
      {!past && booking.status === "booked" ? (
        <div className="mt-6 space-y-3">
          <Button size="parent" variant="outline" nativeButton={false} render={<Link href="/next/book" />}>
            Change the time
          </Button>
          <form action={cancelBooking}>
            <Button type="submit" size="parent" variant="ghost" className="text-muted-foreground">
              Cancel this booking
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            Cancelling keeps your enquiry open. You can book again any time.
          </p>
        </div>
      ) : null}
      <p className="mt-6 text-sm">
        <Link href="/next" className="font-medium text-primary underline underline-offset-2">
          Back to your application
        </Link>
      </p>
    </>
  );
}
