import Link from "next/link";
import { TriangleAlert, ArrowRight, CalendarDays, SquareCheck, CreditCard, FileText, Scale, Users } from "lucide-react";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { BookingBadge, PriorityBadge } from "@/components/staff/status-badge";
import { formatDate, formatTime, toSchoolDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

type Counts = Record<string, number>;

/**
 * The first screen of the day. Four numbers that need a person, today's
 * sittings, the pipeline from enquiry to enrolled, this person's tasks,
 * and one reminder card that names the most pressing thing. Anything at
 * zero is not shown: a quiet dashboard is the goal, not a full one.
 */
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
      .limit(6),
  ]);
  const c = (countsRaw ?? {}) as Counts;
  const n = (k: string) => c[k] ?? 0;
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  const attention: Array<{ label: string; value: number; href: string; urgent?: boolean }> = [
    { label: "Written answers waiting for a marker", value: n("awaiting_marking"), href: "/staff/assessments/today" },
    { label: "Applicants waiting for a decision", value: n("awaiting_decision"), href: "/staff/decisions" },
    { label: "Offers waiting for approval", value: n("offers_to_approve"), href: "/staff/offers" },
    { label: "Outcomes to send", value: n("outcomes_to_send"), href: "/staff/offers" },
    { label: "Offers blocked: no fee schedule", value: n("offers_blocked"), href: "/staff/offers", urgent: true },
    { label: "Offers expiring within 3 days", value: n("offers_expiring_3d"), href: "/staff/offers" },
    { label: "No-shows to follow up", value: n("no_shows_unresolved"), href: "/staff/applications?status=no_show" },
    { label: "Enquiries not booked after 48 hours", value: n("unbooked_over_48h"), href: "/staff/applications?status=new_enquiry" },
    { label: "Callbacks requested", value: n("callbacks_open"), href: "/staff/tasks?type=callback" },
    { label: "Payments overdue", value: n("payments_overdue"), href: "/staff/payments", urgent: true },
    { label: "Payments that did not complete", value: n("payments_failed"), href: "/staff/payments" },
    { label: "Parents still to upload documents", value: n("documents_missing"), href: "/staff/registrations" },
    { label: "Enrolments to confirm", value: n("enrolments_to_confirm"), href: "/staff/registrations" },
    { label: "Waitlist places available", value: n("waitlist_places"), href: "/staff/tasks?type=waitlist_place_available" },
    { label: "WhatsApp replies to read", value: n("parent_replies"), href: "/staff/tasks?type=parent_replied" },
    { label: "Tasks overdue", value: n("tasks_overdue"), href: "/staff/tasks?filter=overdue", urgent: true },
  ].filter((a) => a.value > 0);
  const reminder = attention.find((a) => a.urgent) ?? attention[0] ?? null;

  const pipeline = [
    { label: "New enquiries", value: n("new_enquiries"), href: "/staff/applications?group=enquiry" },
    { label: "Visits booked", value: n("visits_booked"), href: "/staff/applications?status=visit_booked" },
    { label: "Assessments this week", value: n("assessments_this_week"), href: "/staff/assessments/today" },
    { label: "Awaiting a decision", value: n("awaiting_decision"), href: "/staff/decisions" },
    { label: "Offers out with parents", value: n("offers_outstanding"), href: "/staff/applications?status=offer_sent" },
    { label: "Paying", value: n("payments_outstanding"), href: "/staff/payments" },
    { label: "Registering", value: n("registrations_incomplete"), href: "/staff/registrations" },
    { label: "Enrolled", value: n("enrolled"), href: "/staff/applications?status=enrolled" },
    { label: "Withdrawn", value: n("withdrawn"), href: "/staff/applications?status=withdrawn" },
  ];

  return (
    <>
      <PageTitle title="Dashboard" />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section aria-label="Today's assessments" className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div>
                <h2 className="font-semibold">Today&rsquo;s assessments</h2>
                <p className="text-xs text-muted-foreground">{formatDate(new Date())}</p>
              </div>
              <Link href="/staff/assessments/today" className="text-xs font-medium text-primary hover:underline">Open check-in board</Link>
            </div>
            {todays && todays.length > 0 ? (
              <ul className="divide-y divide-border/70">
                {todays.map((b) => {
                  const app = one(b.applications);
                  const s = one(b.sessions);
                  const grade = one(app?.grades ?? null);
                  const campus = one(s?.campuses ?? null);
                  return (
                    <li key={b.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
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
              <div className="px-5 pb-5"><EmptyState>No assessments booked for today.</EmptyState></div>
            )}
          </section>

          <section aria-label="Pipeline" className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-semibold">Pipeline</h2>
              <Link href="/staff/applications" className="text-xs font-medium text-primary hover:underline">View all applicants</Link>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Stage</th><th className="text-right">Applicants</th><th className="w-8" /></tr>
              </thead>
              <tbody>
                {pipeline.map((p) => (
                  <tr key={p.label}>
                    <td><Link href={p.href} className="font-medium hover:underline">{p.label}</Link></td>
                    <td className="text-right font-semibold tabular-nums">{p.value}</td>
                    <td className="text-muted-foreground"><ArrowRight className="size-4" aria-hidden /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {attention.length > 0 ? (
            <section aria-label="Needs attention" className="surface">
              <div className="px-5 pt-4 pb-2">
                <h2 className="font-semibold">Needs attention</h2>
                <p className="text-xs text-muted-foreground">Only what is waiting on a person. When this list is empty, the day is clear.</p>
              </div>
              <ul className="divide-y divide-border/70">
                {attention.map((a) => (
                  <li key={a.label}>
                    <Link href={a.href} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50">
                      <span className={a.urgent ? "flex size-6 items-center justify-center rounded-full bg-destructive/12 text-destructive" : "flex size-6 items-center justify-center rounded-full bg-warning/30 text-warning-foreground"}>
                        <TriangleAlert className="size-3.5" aria-hidden />
                      </span>
                      <span className="flex-1">{a.label}</span>
                      <span className="font-semibold tabular-nums">{a.value}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="To decide" value={n("awaiting_decision")} icon={Scale} tone="warning" href="/staff/decisions" />
            <StatTile label="To approve" value={n("offers_to_approve")} icon={FileText} tone="warning" href="/staff/offers" />
            <StatTile label="Overdue pay" value={n("payments_overdue")} icon={CreditCard} tone="destructive" href="/staff/payments" />
            <StatTile label="Enrolled" value={n("enrolled")} icon={Users} tone="success" href="/staff/applications?status=enrolled" />
          </div>

          <section aria-label="Reminder" className="rounded-2xl bg-primary p-5 text-primary-foreground shadow-lift">
            <p className="text-[11px] font-semibold tracking-[0.12em] uppercase opacity-80">Don&rsquo;t forget</p>
            {reminder ? (
              <>
                <p className="mt-1 text-lg leading-snug font-semibold">{reminder.value} {reminder.label.toLowerCase()}</p>
                <Link href={reminder.href} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium hover:bg-white/25">
                  Go there <ArrowRight className="size-4" aria-hidden />
                </Link>
              </>
            ) : (
              <>
                <p className="mt-1 text-lg leading-snug font-semibold">Everything is up to date.</p>
                <p className="mt-1 text-sm opacity-80">{n("assessments_this_week")} assessments booked this week.</p>
              </>
            )}
          </section>

          <section aria-label="My tasks" className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-semibold">My tasks</h2>
              <Link href="/staff/tasks" className="text-xs font-medium text-primary hover:underline">All tasks</Link>
            </div>
            {myTasks && myTasks.length > 0 ? (
              <ul className="divide-y divide-border/70">
                {myTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <SquareCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Link href={t.application_id ? `/staff/applications/${t.application_id}` : "/staff/tasks"} className="min-w-0 flex-1 truncate hover:underline">{t.title}</Link>
                    <span className="text-xs text-muted-foreground">{t.due_at ? formatDate(t.due_at) : ""}</span>
                    <PriorityBadge priority={t.priority} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 pb-5"><EmptyState>Nothing assigned to you.</EmptyState></div>
            )}
          </section>

          <section aria-label="This week" className="surface px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent text-primary"><CalendarDays className="size-4" aria-hidden /></span>
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Assessments this week</p>
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{n("assessments_this_week")}</p>
            <p className="text-xs text-muted-foreground">{n("assessments_today")} today</p>
          </section>
        </div>
      </div>
    </>
  );
}
