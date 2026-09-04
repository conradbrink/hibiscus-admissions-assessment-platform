import { CalendarPlus, MapPin } from "lucide-react";
import { formatDateLong, formatTime } from "@/lib/format-date";

export function BookingCard({
  kind,
  startsAt,
  campusName,
  location,
  reference,
  qrDataUrl,
}: {
  kind: "assessment" | "visit";
  startsAt: string;
  campusName: string;
  location: string | null;
  reference: string;
  qrDataUrl?: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="bg-primary px-5 py-4 text-primary-foreground">
        <p className="text-xs font-semibold tracking-wide uppercase opacity-90">
          {kind === "assessment" ? "Assessment" : "School visit"}
        </p>
        <p className="mt-1 text-xl font-bold">{formatDateLong(startsAt)}</p>
        <p className="text-lg">{formatTime(startsAt)}</p>
      </div>
      <div className="space-y-3 px-5 py-4 text-sm">
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">{campusName}</span>
            {location ? <span className="block text-muted-foreground">{location}</span> : null}
          </span>
        </p>
        <p className="text-muted-foreground">
          Reference <span className="font-mono font-semibold text-foreground">{reference}</span>
        </p>
        {qrDataUrl ? (
          <div className="flex items-center gap-4 rounded-xl bg-muted p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated on the server; next/image adds nothing and needs a width it cannot know */}
            <img src={qrDataUrl} alt={`QR code for reference ${reference}`} className="size-24 rounded-md bg-white" />
            <p className="text-xs text-muted-foreground">
              Show this at reception when you arrive, or just give your name. No paperwork.
            </p>
          </div>
        ) : null}
        <a
          href="/next/booking.ics"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-2"
        >
          <CalendarPlus className="size-4" aria-hidden />
          Add to calendar
        </a>
      </div>
    </div>
  );
}
