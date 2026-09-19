"use client";

import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/staff/page-title";
import { groupByDay, TIMELINE_KIND_LABELS, type TimelineEntry, type TimelineKind } from "@/lib/crm/timeline";
import { formatDateLong, formatTime, toSchoolDateString } from "@/lib/format-date";

const DOT: Record<TimelineKind, string> = {
  admissions: "bg-info",
  enrolment: "bg-success",
  email: "bg-chart-2",
  whatsapp: "bg-success",
  task: "bg-warning",
  note: "bg-muted-foreground",
  opportunity: "bg-primary",
  event: "bg-chart-4",
  campaign: "bg-chart-2",
  lifecycle: "bg-primary",
  onboarding: "bg-info",
  reenrolment: "bg-warning",
  audit: "bg-muted-foreground",
};

/**
 * The timeline as a person reads it: grouped by day, newest first, with a
 * filter by kind and "show more" rather than a scrollbar the length of eight
 * years. Client-side only for the filter and the fold; the entries arrive
 * merged and sorted from the server.
 */
export function FamilyTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [kind, setKind] = useState<TimelineKind | "all">("all");
  const [limit, setLimit] = useState(30);
  const kinds = [...new Set(entries.map((e) => e.kind))];
  const filtered = kind === "all" ? entries : entries.filter((e) => e.kind === kind);
  const shown = filtered.slice(0, limit);
  const groups = groupByDay(shown, (iso) => toSchoolDateString(new Date(iso)));

  if (!entries.length) return <div className="px-5 pb-5"><EmptyState>Nothing has happened yet.</EmptyState></div>;

  return (
    <div className="px-5 pb-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setKind("all")} className={`rounded-full border px-2.5 py-0.5 text-xs ${kind === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>All</button>
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-2.5 py-0.5 text-xs ${kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
            {TIMELINE_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <ol className="space-y-4">
        {groups.map((g) => (
          <li key={g.day}>
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{formatDateLong(g.day)}</p>
            <ul className="space-y-1.5 border-l border-border/70 pl-4">
              {g.entries.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ${DOT[e.kind]}`} aria-hidden />
                  <span className="mr-2 text-xs text-muted-foreground">{formatTime(e.at)}</span>
                  {e.href ? <Link href={e.href} className="font-medium hover:underline">{e.title}</Link> : <span className="font-medium">{e.title}</span>}
                  {e.actor ? <span className="ml-2 text-xs text-muted-foreground">{e.actor}</span> : null}
                  {e.detail ? <span className="block text-xs text-muted-foreground">{e.detail}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {filtered.length > limit ? (
        <button type="button" onClick={() => setLimit((n) => n + 50)} className="mt-3 text-xs font-medium text-primary hover:underline">
          Show {Math.min(50, filtered.length - limit)} more of {filtered.length - limit}
        </button>
      ) : null}
    </div>
  );
}
