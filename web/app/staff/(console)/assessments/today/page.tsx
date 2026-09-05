import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { BookingBadge } from "@/components/staff/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateLong, formatTime, toSchoolDateString } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { checkIn, markNoShow } from "../../applications/[id]/actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The check-in board. One row per booked child, grouped by session. The
 * parent gives a name or reference at reception; staff finds the row and
 * taps Check in. Nothing else is asked of anybody.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; campus?: string; q?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("assessments.deliver");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : toSchoolDateString(new Date());
  const canDeliver = can(permissions, "assessments.deliver");

  let sessionsQuery = supabase
    .from("sessions")
    .select("id, kind, starts_at, ends_at, location, capacity, campuses(name), staff_profiles!sessions_assessor_staff_id_fkey(full_name)")
    .eq("kind", "assessment")
    .gte("starts_at", `${date}T00:00:00+02:00`)
    .lt("starts_at", `${date}T23:59:59+02:00`)
    .order("starts_at");
  if (sp.campus) sessionsQuery = sessionsQuery.eq("campus_id", sp.campus);

  const [{ data: sessions }, { data: campuses }] = await Promise.all([
    sessionsQuery,
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const bookingsRes = sessionIds.length
    ? await supabase
        .from("bookings")
        .select("id, session_id, status, checked_in_at, applications(id, reference, child_first_name, child_last_name, child_date_of_birth, grades!applications_grade_id_fkey(name), contacts(first_name, last_name, mobile))")
        .in("session_id", sessionIds)
        .in("status", ["booked", "checked_in", "in_progress", "completed", "no_show"])
    : null;
  const bookings = bookingsRes?.data ?? [];
  type BookingRow = (typeof bookings)[number];

  const q = (sp.q ?? "").trim().toLowerCase();
  const byId = new Map<string, BookingRow[]>();
  for (const b of bookings) {
    const app = one(b.applications);
    if (q) {
      const hay = `${app?.child_first_name} ${app?.child_last_name} ${app?.reference}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    (byId.get(b.session_id) ?? byId.set(b.session_id, []).get(b.session_id)!).push(b);
  }

  const prev = new Date(`${date}T12:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const totals = bookings.reduce(
    (acc, b) => {
      acc.total += 1;
      if (b.status === "checked_in" || b.status === "in_progress" || b.status === "completed") acc.arrived += 1;
      if (b.status === "no_show") acc.noShow += 1;
      return acc;
    },
    { total: 0, arrived: 0, noShow: 0 }
  );

  return (
    <>
      <PageTitle title="Assessment day" description={`${formatDateLong(date)} · ${totals.total} booked · ${totals.arrived} arrived · ${totals.noShow} no-show`}>
        <Link href={`?date=${prev.toISOString().slice(0, 10)}${sp.campus ? `&campus=${sp.campus}` : ""}`} className="text-sm underline">Previous day</Link>
        <Link href={`?date=${next.toISOString().slice(0, 10)}${sp.campus ? `&campus=${sp.campus}` : ""}`} className="text-sm underline">Next day</Link>
      </PageTitle>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <Input type="date" name="date" defaultValue={date} className="w-40" />
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <Input name="q" placeholder="Find by name or reference" defaultValue={sp.q ?? ""} className="w-56" autoFocus />
        <Button type="submit" size="lg" variant="secondary">Go</Button>
      </form>

      {sessions && sessions.length > 0 ? (
        <div className="space-y-4">
          {sessions.map((s) => {
            const rows = byId.get(s.id) ?? [];
            const assessor = one(s.staff_profiles);
            return (
              <section key={s.id} className="rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold">
                    {formatTime(s.starts_at)}–{formatTime(s.ends_at)} · {one(s.campuses)?.name}
                    {s.location ? ` · ${s.location}` : ""}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {rows.length}/{s.capacity} · {assessor?.full_name ? `Assessor ${assessor.full_name}` : "No assessor set"}
                  </span>
                </div>
                {rows.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {rows.map((b) => {
                      const app = one(b.applications)!;
                      const grade = one(app.grades);
                      const contact = one(app.contacts);
                      const live = b.status === "booked" || b.status === "checked_in";
                      return (
                        <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                          <div className="min-w-0 flex-1">
                            <Link href={`/staff/applications/${app.id}`} className="font-medium hover:underline">
                              {app.child_first_name} {app.child_last_name}
                            </Link>
                            <span className="ml-2 text-xs text-muted-foreground">{grade?.name} · {app.reference}</span>
                            <span className="block text-xs text-muted-foreground">
                              {contact?.first_name} {contact?.last_name}{contact?.mobile ? ` · ${contact.mobile}` : ""}
                            </span>
                          </div>
                          <BookingBadge status={b.status} />
                          {canDeliver && b.status === "booked" ? (
                            <ActionForm action={checkIn} label="Check in" variant="success" size="sm">
                              <input type="hidden" name="applicationId" value={app.id} />
                            </ActionForm>
                          ) : null}
                          {canDeliver && live ? (
                            <ActionForm action={markNoShow} label="No-show" variant="ghost" size="sm" confirm="Mark as a no-show and email a rebooking link?">
                              <input type="hidden" name="applicationId" value={app.id} />
                            </ActionForm>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="p-4"><EmptyState>Nobody booked{q ? " matching your search" : ""}.</EmptyState></div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState>
          No assessment sessions on this day.{" "}
          <Link href="/staff/admin/sessions" className="underline">Publish sessions</Link>
        </EmptyState>
      )}
    </>
  );
}
