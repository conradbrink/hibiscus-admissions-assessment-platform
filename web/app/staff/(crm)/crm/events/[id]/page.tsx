import Link from "next/link";
import { notFound } from "next/navigation";
import { RegistrationBadge } from "@/components/crm/bits";
import { EventForm } from "@/components/crm/event-form";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EVENT_KIND_LABELS, EVENT_REGISTRATION_LABELS } from "@/lib/crm/labels";
import { formatDateLong, formatTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { siteUrl } from "@/lib/tokens";
import type { EventRegistrationStatus } from "@/lib/supabase/types";
import { inviteSegment, registerFamily, setRegistrationStatus } from "../actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const STATUSES: EventRegistrationStatus[] = ["invited", "registered", "attended", "no_show", "cancelled"];

/**
 * One event: who was invited, who said yes, who came. Staff register a
 * family by hand, invite a whole segment, or start the campaign that
 * carries the invitation — whose link lands families on their own dates
 * page, where they say yes themselves.
 */
export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ family?: string; edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.write");
  const { data: event } = await supabase.from("crm_events").select("*, campuses(name), staff_profiles!crm_events_staff_id_fkey(full_name)").eq("id", id).maybeSingle();
  if (!event) notFound();
  const [{ data: regs }, { data: segments }, { data: campuses }, { data: staff }, { data: preselected }, { data: campaigns }] = await Promise.all([
    supabase.from("crm_event_registrations").select("*, families!crm_event_registrations_family_id_fkey(id, display_name, family_code), students(preferred_name, legal_first_name, legal_last_name)").eq("event_id", id).order("created_at"),
    supabase.from("segments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    sp.family ? supabase.from("families").select("id, display_name, family_code, students(id, preferred_name, legal_first_name)").eq("id", sp.family).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("campaigns").select("id, name, status").eq("event_id", id),
  ]);
  const counts = { invited: 0, registered: 0, attended: 0, no_show: 0, cancelled: 0 };
  for (const r of regs ?? []) counts[r.status] += 1;

  return (
    <>
      <PageTitle back={{ href: "/staff/crm/events", label: "Events" }} title={event.name} description={`${EVENT_KIND_LABELS[event.kind]} · ${one(event.campuses)?.name ?? "Every campus"} · ${formatDateLong(event.starts_at)} at ${formatTime(event.starts_at)}${event.location ? ` · ${event.location}` : ""}`}>
        {canWrite ? <Link href={`/staff/crm/events/${id}?edit=1`} className={buttonVariants({ variant: "outline", size: "lg" })}>Edit</Link> : null}
        {can(permissions, "crm.campaigns.write") ? <Link href={`/staff/crm/campaigns/new?event=${id}`} className={buttonVariants({ size: "lg" })}>Send invitations</Link> : null}
      </PageTitle>

      {sp.edit && canWrite ? <div className="mb-5"><EventForm event={event} campuses={campuses ?? []} staff={staff ?? []} /></div> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUSES.map((s) => (
          <div key={s} className="surface px-4 py-3"><p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{EVENT_REGISTRATION_LABELS[s]}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{counts[s]}</p></div>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Registration link for families: sent with the campaign as a personal link, or from the family&rsquo;s own pages at {siteUrl()}/family/dates. {event.capacity ? `Capacity ${event.capacity}.` : ""} {event.description ?? ""}
        {campaigns?.length ? <> Campaigns: {campaigns.map((c) => <Link key={c.id} href={`/staff/crm/campaigns/${c.id}`} className="underline">{c.name} ({c.status})</Link>)}.</> : null}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="surface lg:col-span-2">
          <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">Attendees</h2></div>
          {regs?.length ? (
            <ul className="divide-y divide-border/70">
              {regs.map((r) => {
                const fam = one(r.families);
                const st = one(r.students);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/staff/crm/families/${r.family_id}`} className="font-medium hover:underline">{fam?.display_name ?? fam?.family_code} family</Link>
                      <span className="block text-xs text-muted-foreground">{st ? `${st.preferred_name || st.legal_first_name} ${st.legal_last_name} · ` : ""}{r.guests ? `+${r.guests} · ` : ""}{r.source}{r.note ? ` · ${r.note}` : ""}</span>
                    </div>
                    <RegistrationBadge status={r.status} />
                    {canWrite ? (
                      <ActionForm action={setRegistrationStatus} label="Set" size="xs" variant="outline" resetOnSubmit={false} className="flex items-center gap-1 space-y-0">
                        <input type="hidden" name="registrationId" value={r.id} />
                        <input type="hidden" name="eventId" value={id} />
                        <NativeSelect name="status" defaultValue={r.status} className="h-7 w-32 py-0 text-xs md:h-7" aria-label="Status">{STATUSES.map((s) => <option key={s} value={s}>{EVENT_REGISTRATION_LABELS[s]}</option>)}</NativeSelect>
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <div className="px-5 pb-5"><EmptyState>Nobody yet. Invite a segment, or register a family from its page.</EmptyState></div>}
        </section>
        {canWrite ? (
          <div className="space-y-4">
            <section className="surface p-4">
              <h2 className="text-sm font-semibold">Register a family</h2>
              {preselected ? (
                <ActionForm action={registerFamily} label="Register" size="sm" className="mt-2 space-y-2">
                  <input type="hidden" name="eventId" value={id} />
                  <input type="hidden" name="familyId" value={preselected.id} />
                  <p className="text-sm">{preselected.display_name ?? preselected.family_code} family</p>
                  <NativeSelect name="studentId" defaultValue="" aria-label="Child"><option value="">The whole family</option>{(preselected.students ?? []).map((s) => <option key={s.id} value={s.id}>{s.preferred_name || s.legal_first_name}</option>)}</NativeSelect>
                  <NativeSelect name="status" defaultValue="registered" aria-label="As"><option value="registered">Registered</option><option value="invited">Invited</option></NativeSelect>
                  <Input name="guests" type="number" min={0} max={20} defaultValue={0} aria-label="Guests" />
                </ActionForm>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Open the family&rsquo;s page and choose this event under &ldquo;Invite to an event&rdquo;.</p>
              )}
            </section>
            <section className="surface p-4">
              <h2 className="text-sm font-semibold">Invite a segment</h2>
              <p className="text-xs text-muted-foreground">Every family in the segment is marked invited. Send the invitation itself as a campaign.</p>
              {segments?.length ? (
                <ActionForm action={inviteSegment} label="Invite" size="sm" variant="outline" className="mt-2 flex items-center gap-2 space-y-0">
                  <input type="hidden" name="eventId" value={id} />
                  <NativeSelect name="segmentId" defaultValue={segments[0].id} aria-label="Segment">{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
                </ActionForm>
              ) : <p className="mt-1 text-xs text-muted-foreground">No segments yet.</p>}
            </section>
          </div>
        ) : null}
      </div>
    </>
  );
}
