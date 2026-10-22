"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { countdownParts } from "@/lib/events/pricing";

/**
 * The time left on the early price, ticking each second.
 *
 * It counts from the server's clock, not the phone's: a handset set to the
 * wrong day would otherwise show a buyer a price the server no longer gives.
 * The server's "now" arrives as a prop and the browser only adds the seconds
 * that have passed since. When it reaches zero the page is fetched again, so
 * the price on the button changes with it.
 *
 * Decorative to a screen reader, which is told the end date once, in words,
 * by the page around it; a number read aloud every second helps nobody.
 */
export function Countdown({ until, serverNow }: { until: string; serverNow: string }) {
  const router = useRouter();
  const target = new Date(until).getTime();
  const base = new Date(serverNow).getTime();
  const [now, setNow] = useState(base);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setNow(base + (Date.now() - started)), 1000);
    return () => window.clearInterval(id);
  }, [base]);

  const done = now >= target;
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  const parts = countdownParts(new Date(target), new Date(now));
  const cells: Array<[number, string]> = [
    [parts.days, parts.days === 1 ? "day" : "days"],
    [parts.hours, parts.hours === 1 ? "hour" : "hours"],
    [parts.minutes, "min"],
    [parts.seconds, "sec"],
  ];
  return (
    <div aria-hidden className="grid grid-cols-4 gap-2">
      {cells.map(([value, label]) => (
        <div key={label} className="rounded-xl bg-foreground/[0.04] px-1 py-2.5 text-center ring-1 ring-foreground/10">
          <span className="block text-2xl leading-none font-bold tracking-tight tabular-nums sm:text-3xl">
            {String(value).padStart(2, "0")}
          </span>
          <span className="mt-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        </div>
      ))}
    </div>
  );
}
