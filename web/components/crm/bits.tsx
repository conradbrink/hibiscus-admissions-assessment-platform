import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LIFECYCLE_LABELS, LIFECYCLE_TONE } from "@/lib/crm/lifecycle";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONE,
  EVENT_REGISTRATION_LABELS,
  EVENT_REGISTRATION_TONE,
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_STATUS_TONE,
} from "@/lib/crm/labels";
import { formatDate, formatDateTime } from "@/lib/format-date";
import type { CampaignStatus, EventRegistrationStatus, LifecycleStage, OpportunityStatus } from "@/lib/supabase/types";

/** The small, shared pieces every CRM page draws with. */

export function LifecycleBadge({ stage }: { stage: LifecycleStage }) {
  return <Badge variant={LIFECYCLE_TONE[stage]}>{LIFECYCLE_LABELS[stage]}</Badge>;
}

export function OpportunityBadge({ status }: { status: OpportunityStatus }) {
  return <Badge variant={OPPORTUNITY_STATUS_TONE[status]}>{OPPORTUNITY_STATUS_LABELS[status]}</Badge>;
}

export function CampaignBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant={CAMPAIGN_STATUS_TONE[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}

export function RegistrationBadge({ status }: { status: EventRegistrationStatus }) {
  return <Badge variant={EVENT_REGISTRATION_TONE[status]}>{EVENT_REGISTRATION_LABELS[status]}</Badge>;
}

export function ConsentDot({ on, label }: { on: boolean | null | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs" title={`${label}: ${on ? "yes" : "no"}`}>
      <span className={`inline-block size-2 rounded-full ${on ? "bg-success" : "bg-border"}`} aria-hidden />
      {label}
    </span>
  );
}

export function Tags({ tags }: { tags: readonly string[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Link key={t} href={`/staff/crm/families?tag=${encodeURIComponent(t)}`} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
          {t}
        </Link>
      ))}
    </span>
  );
}

/** "3 days ago", or the date once it is more than a fortnight. */
export function Ago({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">never</span>;
  const days = Math.floor((new Date().getTime() - new Date(value).getTime()) / 86_400_000);
  if (days < 0) return <span>{formatDate(value)}</span>;
  if (days === 0) return <span title={formatDateTime(value)}>today</span>;
  if (days === 1) return <span title={formatDateTime(value)}>yesterday</span>;
  if (days < 14) return <span title={formatDateTime(value)}>{days} days ago</span>;
  return <span title={formatDateTime(value)}>{formatDate(value)}</span>;
}

/** Page N of M, with the two links. */
export function Pagination({ page, pages, qs }: { page: number; pages: number; qs: (patch: Record<string, string | undefined>) => string }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>Page {page} of {pages}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="rounded-full border border-border px-3 py-1 hover:bg-muted">Previous</Link> : null}
        {page < pages ? <Link href={qs({ page: String(page + 1) })} className="rounded-full border border-border px-3 py-1 hover:bg-muted">Next</Link> : null}
      </span>
    </div>
  );
}

/** A pill-shaped tab link, in the style the tasks page uses. */
export function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-full border px-3 py-1 text-xs ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}>
      {children}
    </Link>
  );
}

/** A label above a value, for the profile's fact lists. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

/** Builds a query string from the current search params and a patch. */
export function queryBuilder(current: Record<string, string | undefined>) {
  return (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
}
