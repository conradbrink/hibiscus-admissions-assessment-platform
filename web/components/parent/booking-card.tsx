import { CalendarPlus, MapPin } from "lucide-react";
import type { BookingNoun } from "@/lib/booking/noun";
import { formatDateLong, formatTime } from "@/lib/format-date";

export function BookingCard({
  noun,
  startsAt,
  campusName,
  location,
  address,
  mapsUrl,
  reference,
  qrDataUrl,
}: {
  /** What this family's booking is called. See lib/booking/noun.ts. */
  noun: BookingNoun;
  startsAt: string;
  campusName: string;
  location: string | null;
  /** The campus's address and phone lines, one per line. */
  address?: string | null;
  /** A link that opens the campus in a maps app. Omitted when the school has not set one. */
  mapsUrl?: string | null;
  reference: string;
  qrDataUrl?: string | null;
}) {
  const addressLines = (address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="overflow-hidden surface">
      <div className="bg-primary px-5 py-4 text-primary-foreground">
        <p className="text-xs font-semibold tracking-wide uppercase opacity-90">
          {/* "School visit" rather than "Visit" only here: on a card with
              nothing else on it, the bare word reads like an instruction. */}
          {noun === "assessment" ? "Assessment" : noun === "visit" ? "School visit" : "Play date"}
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
            {addressLines.map((line) => (
              <span key={line} className="block text-muted-foreground">{line}</span>
            ))}
            {/* A plot number is not something a parent can drive to. */}
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-block font-medium text-primary underline underline-offset-4"
              >
                Get directions
              </a>
            ) : null}
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
