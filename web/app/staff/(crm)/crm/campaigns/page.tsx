import Link from "next/link";
import { CampaignBadge, Pill, queryBuilder } from "@/components/crm/bits";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { CAMPAIGN_CATEGORY_LABELS, CAMPAIGN_CHANNEL_LABELS, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS } from "@/lib/crm/labels";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { CampaignStatus } from "@/lib/supabase/types";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("crm.read");
  let q = supabase.from("campaigns").select("*, segments(name), campuses(name), staff_profiles!campaigns_created_by_fkey(full_name)").order("created_at", { ascending: false }).limit(200);
  const status = (CAMPAIGN_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as CampaignStatus) : null;
  if (status) q = q.eq("status", status);
  const { data: rows } = await q;
  const qs = queryBuilder(sp);
  return (
    <>
      <PageTitle title="Campaigns" description="One message to one audience, on WhatsApp, email or both. Approved by a second person, sent by the system, tracked here.">
        {can(permissions, "crm.campaigns.write") ? <Link href="/staff/crm/campaigns/new" className={buttonVariants({ size: "lg" })}>New campaign</Link> : null}
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Pill href={qs({ status: undefined })} active={!status}>All</Pill>
        {CAMPAIGN_STATUSES.map((s) => <Pill key={s} href={qs({ status: s })} active={status === s}>{CAMPAIGN_STATUS_LABELS[s]}</Pill>)}
      </div>
      {rows?.length ? (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/staff/crm/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                <p className="text-xs text-muted-foreground">
                  {CAMPAIGN_CHANNEL_LABELS[c.channel]} · {CAMPAIGN_CATEGORY_LABELS[c.category]} · {one(c.segments)?.name ?? "no audience"} · {one(c.campuses)?.name ?? "every campus"} · by {one(c.staff_profiles)?.full_name ?? "—"} · {formatDateTime(c.created_at)}
                  {c.scheduled_at && (c.status === "scheduled" || c.status === "approved") ? ` · sends ${formatDateTime(c.scheduled_at)}` : ""}{c.finished_at ? ` · sent ${formatDateTime(c.finished_at)}` : ""}
                </p>
              </div>
              {c.recipients_total !== null ? <span className="text-xs text-muted-foreground">{c.recipients_total} families</span> : null}
              <CampaignBadge status={c.status} />
            </li>
          ))}
        </ul>
      ) : <EmptyState>No campaigns{status ? ` ${CAMPAIGN_STATUS_LABELS[status].toLowerCase()}` : " yet"}.</EmptyState>}
    </>
  );
}
