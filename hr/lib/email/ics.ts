/**
 * A minimal iCalendar invitation for an interview, attached to the invitation
 * email so "Add to calendar" is one tap on a phone. Copied from admissions,
 * with a sequence and cancellation so a moved interview replaces itself.
 */
export function buildIcs(opts: {
  uid: string;
  summary: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  /** Raised on every change, so a calendar replaces the event rather than adding a second. */
  sequence?: number;
  cancelled?: boolean;
}): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hibiscus International Schools//Human Resources//EN",
    opts.cancelled ? "METHOD:CANCEL" : "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${opts.uid}@hr.hibiscus`,
    `SEQUENCE:${opts.sequence ?? 0}`,
    ...(opts.cancelled ? ["STATUS:CANCELLED"] : []),
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(opts.startsAt)}`,
    `DTEND:${stamp(opts.endsAt)}`,
    `SUMMARY:${esc(opts.summary)}`,
    `DESCRIPTION:${esc(opts.description)}`,
    `LOCATION:${esc(opts.location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
