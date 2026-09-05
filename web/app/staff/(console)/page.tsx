import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { BookingBadge, PriorityBadge } from "@/components/staff/status-badge";
import { formatDate, formatTime, toSchoolDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

type Counts = Record<string, number>;

export default async function DashboardPage() {
  const { supabase, userId } = await requireStaff("applications.read");
  const today = toSchoolDateString(new Date());

  const [{ data: countsRaw }, { data: todays }, { data: myTasks }] = await Promise.all([
    supabase.rpc("dashboard_counts"),
    supabase
      .from("bookings")
      .select("id, status, applications(id, reference, child_first_name, child_last_name, grades!applications_grade_id_fkey(name)), sessions!inner(starts_at, campus_id, campuses(name))")
      .eq("kind", "assessment")
      .in("status", ["booked", "checked_in", "in_progress", "completed"])
      .gte("sessions.starts_at", `${today}T00:00:00+02:00`)
      .lt("sessions.starts_at", `${today}T23:59:59+02:00`)
      .order("starts_at", { referencedTable: "sessions" })
      .limit(50),
    supabase
      .from("tasks")
      .select("id, title, due_at, priority, application_id")
      .eq("status", "open")
      .eq("assignee_staff_id", userId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(8),
  ]);
  const c = (countsRaw ?? {}) as Counts;

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  return (
    <>
      <PageTitle title="Dashboard" description={`Today, ${formatDate(new Date())}`} />

      <section aria-label="Needs attention" className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Awaiting marking" value={c.awaiting_marking ?? 0} tone="warning" href="/staff/assessments/today" />
          <StatTile label="Awaiting review" value={c.staff_review ?? 0} tone="warning" href="/staff/decisions" />
          <StatTile label="Pre-school decisions" value={(c.awaiting_decision ?? 0) - (c.staff_review ?? 0)} tone="warning" href="/staff/decisions" />
          <StatTile label="Offers to approve" value={c.offers_to_approve ?? 0} tone="warning" href="/staff/offers" />
          <StatTile label="Outcomes to send" value={c.outcomes_to_send ?? 0} tone="warning" href="/staff/offers" />
          <StatTile label="Offers blocked on fees" value={c.offers_blocked ?? 0} tone="destructive" href="/staff/offers" />
          <StatTile label="Offers expiring in 3 days" value={c.offers_expiring_3d ?? 0} tone="warning" href="/staff/offers" />
          <StatTile label="No-shows to follow up" value={c.no_shows_unresolved ?? 0} tone="warning" href="/staff/applications?status=no_show" />
          <StatTile label="Unbooked over 48h" value={c.unbooked_over_48h ?? 0} tone="warning" href="/staff/applications?status=new_enquiry" />
          <StatTile label="Callbacks open" value={c.callbacks_open ?? 0} tone="warning" href="/staff/tasks?type=callback" />
          <StatTile label="Tasks overdue" value={c.tasks_overdue ?? 0} tone="destructive" href="/staff/tasks?filter=overdue" />
          <StatTile label="Offers outstanding" value={c.offers_outstanding ?? 0} href="/staff/applications?status=offer_sent" />
          <StatTile label="Payments overdue" value={c.payments_overdue ?? 0} tone="destructive" href="/staff/payments" />
          <StatTile label="Payments not completed" value={c.payments_failed ?? 0} tone="warning" href="/staff/payments" />
          <StatTile label="Parents missing documents" value={c.documents_missing ?? 0} tone="warning" href="/staff/registrations" />
          <StatTile label="Enrolments to confirm" value={c.enrolments_to_confirm ?? 0} tone="warning" href="/staff/registrations" />
        </div>
      </section>

      <section aria-label="Pipeline" className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Pipeline</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="New enquiries" value={c.new_enquiries ?? 0} href="/staff/applications?group=enquiry" />
          <StatTile label="Assessments today" value={c.assessments_today ?? 0} href="/staff/assessments/today" />
          <StatTile label="Assessments this week" value={c.assessments_this_week ?? 0} href="/staff/assessments/today" />
          <StatTile label="Payments outstanding" value={c.payments_outstanding ?? 0} href="/staff/payments" />
          <StatTile label="Registrations incomplete" value={c.registrations_incomplete ?? 0} href="/staff/registrations" />
          <StatTile label="Enrolled" value={c.enrolled ?? 0} tone="success" href="/staff/applications?status=enrolled" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Today's assessments" className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Today&rsquo;s assessments</h2>
            <Link href="/staff/assessments/today" className="text-xs font-medium text-primary">
              Open check-in board
            </Link>
          </div>
          {todays && todays.length > 0 ? (
            <ul className="divide-y divide-border">
              {todays.map((b) => {
                const app = one(b.applications);
                const s = one(b.sessions);
                const grade = one(app?.grades ?? null);
                const campus = one(s?.campuses ?? null);
                return (
                  <li key={b.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-12 font-mono text-muted-foreground">{s ? formatTime(s.starts_at) : "—"}</span>
                    <Link href={`/staff/applications/${app?.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {app?.child_first_name} {app?.child_last_name}
                    </Link>
                    <span className="hidden text-muted-foreground sm:inline">{grade?.name} · {campus?.name}</span>
                    <BookingBadge status={b.status} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4"><EmptyState>No assessments today.</EmptyState></div>
          )}
        </section>

        <section aria-label="My tasks" className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">My open tasks</h2>
            <Link href="/staff/tasks" className="text-xs font-medium text-primary">
              All tasks
            </Link>
          </div>
          {myTasks && myTasks.length > 0 ? (
            <ul className="divide-y divide-border">
              {myTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link href={t.application_id ? `/staff/applications/${t.application_id}` : "/staff/tasks"} className="min-w-0 flex-1 truncate hover:underline">
                    {t.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{t.due_at ? formatDate(t.due_at) : ""}</span>
                  <PriorityBadge priority={t.priority} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><EmptyState>Nothing assigned to you.</EmptyState></div>
          )}
        </section>
      </div>
    </>
  );
}
