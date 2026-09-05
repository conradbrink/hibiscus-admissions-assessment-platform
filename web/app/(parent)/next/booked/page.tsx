import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { CheckCircle2 } from "lucide-react";
import { BookingCard } from "@/components/parent/booking-card";
import { PageHeader } from "@/components/parent/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { requireParentSession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "Booked" };

export default async function BookedPage() {
  const session = await requireParentSession();
  const graph = await loadApplicationGraph(createAdminClient(), session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  if (!graph.booking) redirect("/next");

  const { application: app, campus, booking, contact } = graph;
  const qr = await QRCode.toDataURL(app.reference, { margin: 1, width: 192 });

  return (
    <>
      <PageHeader
        eyebrow="All done"
        title={
          booking.kind === "assessment"
            ? `${app.child_first_name}'s assessment is booked.`
            : `Your visit to ${campus.name} is booked.`
        }
      />
      <div className="mb-5 flex items-start gap-3 rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-foreground">
          We have emailed the details to <span className="font-medium">{contact.email}</span>. There is
          nothing else to fill in.
        </p>
      </div>
      <BookingCard
        kind={booking.kind}
        startsAt={booking.session.starts_at}
        campusName={campus.name}
        location={booking.session.location}
        reference={app.reference}
        qrDataUrl={qr}
      />
      <div className="mt-6 space-y-2 text-sm text-muted-foreground">
        <p>We will remind you two days before and on the morning.</p>
        <p>
          Need to change the time?{" "}
          <Link href="/next/booking" className="font-medium text-foreground underline underline-offset-2">
            Manage your booking
          </Link>
        </p>
      </div>
    </>
  );
}
