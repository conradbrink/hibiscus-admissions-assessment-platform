import Link from "next/link";
import { CampusPicker } from "@/components/crm/campus-picker";
import { Pill, queryBuilder } from "@/components/crm/bits";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EVENT_KIND_LABELS } from "@/lib/crm/labels";
import { formatDateLong, formatTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ campus?: string; when?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("crm.read");
  const past = sp.when === "past";
  let q = supabase.from("crm_events").select("*, campuses(name), staff_profiles!crm_events_staff_id_fkey(full_name)").order("starts_at", { ascending: !past }).limit(100);
  q = past ? q.lt("starts_at", new Date().toISOString()) : q.gte("starts_at", new Date(new Date().getTime() - 6 * 3_600_000).toISOString());
  if (sp.campus) q = q.or(`campus_id.is.null,campus_id.eq.${sp.campus}`);
  const [{ data: events }, { data: campuses }] = await Promise.all([q, supabase.from("v_accessible_campuses").select("id, name").order("sort_order")]);
  const ids = (events ?? []).map((e) => e.id);
  const { data: regs } = ids.length ? await supabase.from("crm_event_registrations").select("event_id, status, guests").in("event_id", ids) : { data: [] };
  const counts = new Map<string, { invited: number; registered: number; attended: number; no_show: number }>();
  for (const r of regs ?? []) {
    const c = counts.get(r.event_id) ?? { invited: 0, registered: 0, attended: 0, no_show: 0 };
    if (r.status === "invited") c.invited += 1;
    if (r.status === "registered") c.registered += 1 + r.guests;
    if (r.status === "attended") c.attended += 1 + r.guests;
    if (r.status === "no_show") c.no_show += 1;
    counts.set(r.event_id, c);
  }
  const qs = queryBuilder(sp);

  return (
    <>
      <PageTitle title="Events" description="Open days, the Make-a-Thon, parent meetings. Families register from their own pages or are registered here.">
        <CampusPicker campuses={campuses ?? []} current={sp.campus ?? null} />
        {can(permissions, "crm.write") ? <Link href="/staff/crm/events/new" className={buttonVariants({ size: "lg" })}>Add event</Link> : null}
      </PageTitle>
      <div className="mb-4 flex gap-1.5">
        <Pill href={qs({ when: undefined })} active={!past}>Upcoming</Pill>
        <Pill href={qs({ when: "past" })} active={past}>Past</Pill>
      </div>
      {events?.length ? (
        <ul className="space-y-2">
          {events.map((e) => {
            const c = counts.get(e.id) ?? { invited: 0, registered: 0, attended: 0, no_show: 0 };
            return (
              <li key={e.id} className={`surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${e.is_cancelled ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/crm/events/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
                  <span className="ml-2 text-xs text-muted-foreground">{EVENT_KIND_LABELS[e.kind]} · {one(e.campuses)?.name ?? "Every campus"}</span>
                  <p className="text-xs text-muted-foreground">{formatDateLong(e.starts_at)} at {formatTime(e.starts_at)}{e.location ? ` · ${e.location}` : ""}{one(e.staff_profiles) ? ` · ${one(e.staff_profiles)!.full_name}` : ""}</p>
                </div>
                <span className="text-xs text-muted-foreground">{c.invited} invited · {c.registered} registered{e.capacity ? ` of ${e.capacity}` : ""}{past ? ` · ${c.attended} attended · ${c.no_show} did not` : ""}</span>
                {e.is_cancelled ? <Badge variant="muted">Cancelled</Badge> : !e.registration_open ? <Badge variant="warning">Closed</Badge> : <Badge variant="success">Open</Badge>}
              </li>
            );
          })}
        </ul>
      ) : <EmptyState>{past ? "No past events." : "Nothing coming up. Add an event and invite a segment."}</EmptyState>}
    </>
  );
}
