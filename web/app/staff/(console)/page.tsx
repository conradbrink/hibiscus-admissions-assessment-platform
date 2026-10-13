import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { BookingBadge, PriorityBadge } from "@/components/staff/status-badge";
import { bookingNounTitle } from "@/lib/booking/noun";
import { isScholarshipCode } from "@/lib/promotions/scholarship";
import { formatDate, formatTime, toSchoolDateString } from "@/lib/format-date";
import { bookingKindsInScope, todaysBoardEmpty, todaysBoardTitle } from "@/lib/staff/scope";
import { orientationProgress } from "@/lib/orientation";
import { requireStaff } from "@/lib/staff/session";
import { cn } from "@/lib/utils";

type Counts = Record<string, number>;

/**
 * One thing waiting on a person, as a count with somewhere to go. Worded
 * both ways because "1 no-shows to follow up" is what a single label says
 * on a quiet day.
 */
type Metric = { count: number; one: string; many: string; href: string; action: string; urgent?: boolean };

/** The metrics that belong together under one heading, most pressing work first. */
type AttentionArea = { title: string; metrics: Metric[] };

const phrase = (m: Metric) => (m.count === 1 ? m.one : m.many);
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Columns for the attention grid on a wide screen: one row up to four, then rows that come out even. */
const WIDE_COLUMNS = ["lg:grid-cols-1", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"] as const;

/**
 * The first screen of the day, answering three questions in the order they
 * are asked: what needs me, what is happening today, and what is mine to do.
 * Anything at zero is not shown: a quiet dashboard is the goal, not a full one.
 *
 * Every count it shows was on the dashboard before. They are grouped by the
 * kind of work rather than listed one per line, so twenty things waiting
 * read as eight places to go, and the most pressing line of each group (an
 * offer blocked by a missing fee schedule, a WhatsApp the provider refused)
 * is red where it sits instead of in a reminder card of its own.
 */
export default async function DashboardPage() {
  const { supabase, userId, profile } = await requireStaff("applications.read");

  // A colleague who has never opened the orientation is sent to it once —
  // this is the screen they land on when they sign in, so it is the place to
  // do it. Once they have read a single screen they are never redirected
  // again: the line below keeps it in front of them instead, and a person
  // halfway through their first week should not have to fight the dashboard
  // to get at their work.
  const orientation = orientationProgress(profile.orientation_read);
  if (orientation.read === 0 && !profile.orientation_completed_at) redirect("/staff/orientation");
  const now = new Date();
  const today = toSchoolDateString(now);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [
    { data: countsRaw },
    { data: todays },
    { data: myTasks },
    { data: myCampuses },
    { data: offered },
    { count: deferredDueSoon },
    { count: visitsThisWeek },
    { count: failedMessages },
    { count: newThisWeek },
    { count: enrolledThisWeek },
  ] = await Promise.all([
    supabase.rpc("dashboard_counts"),
    // Both kinds. A pre-school campus books no assessments, so a board
    // filtered to them was an empty list on a day with children arriving.
    // `requires_assessment` comes along so each row can say which it is.
    supabase
      .from("bookings")
      .select(
        "id, status, kind, applications(id, reference, child_first_name, child_last_name, requires_assessment, grades!applications_grade_id_fkey(name)), sessions!inner(starts_at, campus_id, campuses(name))"
      )
      .in("status", ["booked", "checked_in", "in_progress", "completed"])
      .gte("sessions.starts_at", `${today}T00:00:00+02:00`)
      .lt("sessions.starts_at", `${today}T23:59:59+02:00`)
      .order("starts_at", { referencedTable: "sessions" })
      .limit(50),
    supabase
      .from("tasks")
      // The subject comes too, so a task written by a person lands here with
      // somewhere to go. One about an applicant or a child links to them;
      // one about a campus says which, and opens the list.
      .select("id, title, due_at, priority, application_id, student_id, campuses(name)")
      .eq("status", "open")
      .eq("assignee_staff_id", userId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(6),
    // What this person's campuses do, for what to call things. No rows is
    // head office: every campus, both words. RLS already decides what they
    // can *see*; this only decides the labels.
    supabase.from("staff_campuses").select("campus_id").eq("staff_id", userId),
    supabase
      .from("campus_grades")
      .select("campus_id, requires_assessment, grades!inner(requires_assessment)")
      .eq("is_active", true),
    // Deferred families whose date is here. The board does not show them —
    // a pause is not a column of the funnel — so this is what stops a
    // family who asked to be called in March going uncalled in March.
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "deferred")
      .lte("deferred_until", toSchoolDateString(weekEnd)),
    // The pre-school counterpart of `assessments_this_week`, which counts
    // `kind = 'assessment'` and is therefore a permanent zero for a
    // pre-school campus.
    supabase
      .from("bookings")
      .select("id, applications!inner(requires_assessment), sessions!inner(starts_at)", { count: "exact", head: true })
      .eq("kind", "visit")
      .eq("applications.requires_assessment", false)
      .in("status", ["booked", "checked_in"])
      .gte("sessions.starts_at", now.toISOString())
      .lt("sessions.starts_at", weekEnd.toISOString()),
    // A WhatsApp the provider refused. Silent everywhere else: the parent
    // simply never hears from us and the funnel looks entirely normal, so
    // this is the only place it surfaces. Seven days, because a template
    // that is broken has been broken since somebody last edited it.
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString()),
    // The week behind, for the summary under "This week". The counts in
    // `dashboard_counts` are where things stand now (every enrolled child,
    // every open enquiry), which is not the same question.
    supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "enrolled").gte("status_changed_at", weekAgo),
  ]);
  const c = (countsRaw ?? {}) as Counts;
  const n = (k: string) => c[k] ?? 0;
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  // Which of today's arrivals hold a scholarship. The board query is rooted at
  // bookings, so the ids come out of the embed; it is capped at 50 rows, so
  // this is one bounded lookup. Without it the board labels a Form 3
  // scholarship student's interview a "Visit".
  const boardAppIds = (todays ?? []).map((b) => one(b.applications)?.id).filter((id): id is string => Boolean(id));
  const { data: boardAwards } = boardAppIds.length
    ? await supabase.from("application_promotions").select("application_id, promotions(code)").in("application_id", boardAppIds)
    : { data: [] };
  const boardScholars = new Set(
    (boardAwards ?? []).filter((a) => isScholarshipCode(one(a.promotions)?.code ?? null)).map((a) => a.application_id)
  );

  const kinds = bookingKindsInScope(
    (offered ?? []).map((o) => ({
      campusId: o.campus_id,
      requiresAssessment: o.requires_assessment,
      gradeRequiresAssessment: one(o.grades)?.requires_assessment ?? false,
    })),
    (myCampuses ?? []).map((r) => r.campus_id)
  );

  // Everything the old "Needs attention" list and its reminder card counted,
  // each with the link it had, grouped by the kind of work. A group shows
  // only while one of its counts is above zero, and leads with the first
  // that is; the rest sit under it as their own links.
  const areas: AttentionArea[] = [
    {
      title: "Enquiries",
      metrics: [
        { count: n("unbooked_over_48h"), one: "enquiry not booked after 48 hours", many: "enquiries not booked after 48 hours", href: "/staff/applications?status=new_enquiry", action: "Follow up" },
        { count: n("callbacks_open"), one: "callback requested", many: "callbacks requested", href: "/staff/tasks?type=callback", action: "Call back" },
        { count: deferredDueSoon ?? 0, one: "deferred family due back", many: "deferred families due back", href: "/staff/applications?status=deferred", action: "Get back in touch" },
      ],
    },
    {
      title: "Assessments",
      metrics: [
        { count: n("awaiting_marking"), one: "written answer waiting for a marker", many: "written answers waiting for a marker", href: "/staff/assessments/today", action: "Mark answers" },
        { count: n("no_shows_unresolved"), one: "no-show to follow up", many: "no-shows to follow up", href: "/staff/applications?status=no_show", action: "Follow up" },
      ],
    },
    {
      title: "Decisions",
      metrics: [
        { count: n("awaiting_decision"), one: "applicant waiting for a decision", many: "applicants waiting for a decision", href: "/staff/decisions", action: "Review applicants" },
        { count: n("waitlist_places"), one: "waitlist place available", many: "waitlist places available", href: "/staff/tasks?type=waitlist_place_available", action: "Review the waitlist" },
      ],
    },
    {
      title: "Offers",
      metrics: [
        { count: n("offers_to_approve"), one: "offer waiting for approval", many: "offers waiting for approval", href: "/staff/offers", action: "Approve offers" },
        { count: n("offers_blocked"), one: "offer blocked: no fee schedule", many: "offers blocked: no fee schedule", href: "/staff/offers", action: "Review offers", urgent: true },
        { count: n("outcomes_to_send"), one: "outcome to send", many: "outcomes to send", href: "/staff/offers", action: "Send outcomes" },
        { count: n("offers_expiring_3d"), one: "offer expiring within 3 days", many: "offers expiring within 3 days", href: "/staff/offers", action: "Review offers" },
      ],
    },
    {
      title: "Payments",
      metrics: [
        { count: n("payments_overdue"), one: "payment overdue", many: "payments overdue", href: "/staff/payments", action: "Follow up", urgent: true },
        { count: n("payments_failed"), one: "payment that did not complete", many: "payments that did not complete", href: "/staff/payments", action: "Follow up" },
      ],
    },
    {
      title: "Enrolments",
      metrics: [
        { count: n("enrolments_to_confirm"), one: "enrolment to confirm", many: "enrolments to confirm", href: "/staff/registrations", action: "Confirm enrolments" },
        { count: n("documents_missing"), one: "parent still to upload documents", many: "parents still to upload documents", href: "/staff/registrations", action: "Complete registration" },
      ],
    },
    {
      title: "Messages",
      metrics: [
        { count: n("parent_replies"), one: "WhatsApp reply to read", many: "WhatsApp replies to read", href: "/staff/tasks?type=parent_replied", action: "Reply" },
        // A template the provider is refusing. It went unnoticed for a day once
        // because a failed WhatsApp is silent everywhere else: the parent simply
        // never hears from us, and the funnel looks normal.
        { count: failedMessages ?? 0, one: "WhatsApp message failed to send", many: "WhatsApp messages failed to send", href: "/staff/admin/message-templates", action: "Check templates", urgent: true },
      ],
    },
    {
      title: "Tasks",
      metrics: [
        { count: n("tasks_overdue"), one: "task overdue", many: "tasks overdue", href: "/staff/tasks?filter=overdue", action: "View overdue tasks", urgent: true },
      ],
    },
  ];
  const attention = areas
    .map((a) => ({ ...a, metrics: a.metrics.filter((m) => m.count > 0) }))
    .filter((a) => a.metrics.length > 0);
  const columns = attention.length <= 4 ? attention.length : attention.length <= 6 ? 3 : 4;

  // The figure beside "Today": what is coming this week, in the words this
  // person's campuses use, and how many are on today's list below it.
  const todayCount = (todays ?? []).length;
  const comingUp = [
    kinds.assessment ? plural(n("assessments_this_week"), "assessment", "assessments") : null,
    kinds.visit ? plural(visitsThisWeek ?? 0, "visit", "visits") : null,
  ].filter(Boolean);
  const todaySummary = `${comingUp.join(" and ")} this week · ${todayCount >= 50 ? "50+" : todayCount} today`;

  const week = [
    kinds.assessment ? { value: n("assessments_this_week"), label: "Assessments" } : null,
    kinds.visit ? { value: visitsThisWeek ?? 0, label: "Visits" } : null,
    { value: newThisWeek ?? 0, label: "New enquiries" },
    { value: enrolledThisWeek ?? 0, label: "Enrolled" },
  ].filter((w): w is { value: number; label: string } => w !== null);

  return (
    <div className="space-y-8 lg:space-y-10">
      {/* Until it is finished. Then it goes, along with the menu item. */}
      {!profile.orientation_completed_at ? (
        <Link
          href={`/staff/orientation/${orientation.remaining[0]?.slug ?? ""}`}
          className={cn("group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-sm transition-colors duration-150 hover:bg-muted/50", focusRing)}
        >
          <span className="font-medium text-foreground">Finish your orientation</span>
          <span className="text-muted-foreground">
            {orientation.read} of {orientation.total} read · next up: {orientation.remaining[0]?.title}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-primary">
            Continue <ArrowRight className={arrowNudge} strokeWidth={2} aria-hidden />
          </span>
        </Link>
      ) : null}

      <section aria-labelledby="attention-heading">
        <SectionHeader id="attention-heading" title="Needs attention" subtitle="Things that need action from your team." />
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {attention.length > 0 ? (
            // Each tile draws its own top and left rule and the grid is pulled
            // one pixel up and left under the clipped edge, so the rules fall
            // between tiles however many rows they wrap to.
            <div className={cn("-mt-px -ml-px grid", attention.length > 1 ? "grid-cols-2" : "grid-cols-1", WIDE_COLUMNS[columns])}>
              {attention.map((area) => (
                <AttentionTile key={area.title} area={area} />
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2.5 px-5 py-4 text-sm text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              Nothing is waiting on a person. The day is clear.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="today-heading">
        <SectionHeader id="today-heading" title="Today" subtitle={todaysBoardTitle(kinds)}>
          <span className="text-muted-foreground tabular-nums">{todaySummary}</span>
          {/* The check-in board is the assessment day: launching sittings
              and marking them. A campus with no assessing grade has no
              such day, and the link led to an empty page. */}
          {kinds.assessment ? <ArrowLink href="/staff/assessments/today">Open check-in board</ArrowLink> : null}
        </SectionHeader>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {todays && todays.length > 0 ? (
            <ul className="divide-y divide-border">
              {todays.map((b) => {
                const app = one(b.applications);
                const s = one(b.sessions);
                const grade = one(app?.grades ?? null);
                const campus = one(s?.campuses ?? null);
                const where = [grade?.name, campus?.name].filter(Boolean).join(" · ");
                // Which of the three this is. On a mixed board the time and
                // the name do not say.
                const kind = bookingNounTitle({ requiresAssessment: app?.requires_assessment ?? true, bookingKind: b.kind, scholarship: app ? boardScholars.has(app.id) : false });
                return (
                  <li
                    key={b.id}
                    className="relative grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-[13px] transition-colors duration-150 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ring sm:grid-cols-[3rem_minmax(0,1.3fr)_minmax(0,1fr)_6.5rem_6.5rem] sm:px-5 sm:py-2.5"
                  >
                    <span className="font-medium text-muted-foreground tabular-nums">{s ? formatTime(s.starts_at) : ""}</span>
                    <div className="min-w-0">
                      {app ? (
                        <Link href={`/staff/applications/${app.id}`} className={cn(stretched, "block truncate text-sm font-medium text-foreground")}>
                          {app.child_first_name} {app.child_last_name}
                        </Link>
                      ) : null}
                      <span className="block truncate text-xs text-muted-foreground sm:hidden">{[where, kind].filter(Boolean).join(" · ")}</span>
                    </div>
                    <span className="hidden truncate text-muted-foreground sm:block">{where}</span>
                    <span className="hidden truncate text-muted-foreground sm:block">{kind}</span>
                    <span className="flex">
                      <BookingBadge status={b.status} className={pill} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">{todaysBoardEmpty(kinds)}</p>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-6">
        <section aria-labelledby="tasks-heading" className="lg:col-span-2">
          <SectionHeader id="tasks-heading" title="My tasks">
            <ArrowLink href="/staff/tasks">All tasks</ArrowLink>
          </SectionHeader>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {myTasks && myTasks.length > 0 ? (
              <ul className="divide-y divide-border">
                {myTasks.map((t) => {
                  const where = t.application_id
                    ? `/staff/applications/${t.application_id}`
                    : t.student_id
                      ? `/staff/students/${t.student_id}`
                      : "/staff/tasks";
                  const due = dueLabel(t.due_at, now);
                  return (
                    <li key={t.id} className="relative flex items-center gap-3 px-4 py-3 text-[13px] transition-colors duration-150 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ring sm:px-5 sm:py-2.5">
                      <Link href={where} className={cn(stretched, "min-w-0 flex-1 truncate text-sm font-medium text-foreground")}>
                        {t.title}
                      </Link>
                      {/* Which school, for a task that names no child. */}
                      {!t.application_id && !t.student_id ? (
                        <span className="hidden shrink-0 text-muted-foreground sm:inline">{one(t.campuses)?.name}</span>
                      ) : null}
                      {due ? (
                        <span className={cn("shrink-0 tabular-nums", due.overdue ? "font-medium text-destructive" : due.soon ? "text-foreground" : "text-muted-foreground")}>
                          {due.label}
                        </span>
                      ) : null}
                      <PriorityBadge priority={t.priority} className={cn(pill, "capitalize")} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">No tasks assigned to you.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="week-heading">
          <SectionHeader id="week-heading" title="This week" />
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {week.map((w) => (
                <li key={w.label} className="flex items-baseline gap-4 px-5 py-2.5 text-[13px]">
                  <span className="w-9 shrink-0 text-right text-[15px] font-semibold text-foreground tabular-nums">{w.value}</span>
                  <span className="text-muted-foreground">{w.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Bookings for the next 7 days. Enquiries and enrolments from the last 7.</p>
        </section>
      </div>
    </div>
  );
}

/** A keyboard focus ring that matches the brand colour, on whatever it is given. */
const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * A link that makes its whole row or tile the click target, through a
 * pseudo-element laid over its positioned parent. The parent draws the focus
 * ring (`has-[a:focus-visible]`) around the whole target, so the link itself
 * draws none.
 */
const stretched = "outline-none after:absolute after:inset-0 after:content-['']";

/** The status and priority badges here: compact, squared off, not the default pill. */
const pill = "h-[1.375rem] rounded-md px-1.5 text-[11.5px]";

/** An arrow that leans a couple of pixels toward where its link goes, on hover, where motion is welcome. */
const arrowNudge = "size-3.5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:translate-x-0.5";

/** A section's name, one plain line under it, and its links on the right. */
function SectionHeader({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] leading-6 font-semibold text-balance text-foreground">{title}</h2>
        {subtitle ? <p className="text-[13px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">{children}</div> : null}
    </div>
  );
}

function ArrowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-1 rounded-sm font-medium text-primary transition-colors duration-150 hover:text-accent-foreground", focusRing)}>
      {children}
      <ArrowRight className={arrowNudge} strokeWidth={2} aria-hidden />
    </Link>
  );
}

/**
 * One kind of work: the count that leads it, what that count is, the other
 * counts in the same kind as their own links, and what to do about it. The
 * whole tile goes where the action goes; the smaller lines go to theirs.
 */
function AttentionTile({ area }: { area: AttentionArea }) {
  const [lead, ...rest] = area.metrics;
  const urgent = area.metrics.some((m) => m.urgent);
  return (
    <div className="group relative flex flex-col border-t border-l border-border p-4 transition-colors duration-150 hover:bg-muted/50 has-[>a:focus-visible]:bg-muted/50 has-[>a:focus-visible]:outline-2 has-[>a:focus-visible]:-outline-offset-2 has-[>a:focus-visible]:outline-ring sm:px-5 sm:py-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <span className={cn("size-1.5 shrink-0 rounded-full", urgent ? "bg-destructive" : "bg-warning")} aria-hidden />
        {area.title}
      </p>
      <p className="mt-3 text-[1.75rem] leading-none font-semibold tracking-tight text-foreground tabular-nums">{lead.count}</p>
      <p className={cn("mt-2 text-[13px] leading-snug", lead.urgent ? "font-medium text-destructive" : "text-foreground/80")}>{sentence(phrase(lead))}</p>
      {rest.length > 0 ? (
        <ul className="mt-2.5 space-y-1 text-xs leading-snug">
          {rest.map((m) => (
            <li key={m.many}>
              <Link
                href={m.href}
                className={cn(
                  "relative z-10 rounded-sm underline-offset-2 transition-colors duration-150 hover:underline",
                  focusRing,
                  m.urgent ? "font-medium text-destructive" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="tabular-nums">{m.count}</span> {phrase(m)}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <Link
        href={lead.href}
        aria-label={`${lead.action}: ${lead.count} ${phrase(lead)}`}
        className={cn(stretched, "mt-auto inline-flex items-center gap-1 self-start pt-4 text-[13px] font-medium text-primary transition-colors duration-150 group-hover:text-accent-foreground")}
      >
        {lead.action}
        <ArrowRight className={arrowNudge} strokeWidth={2} aria-hidden />
      </Link>
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * When a task is due, the way a person says it: today, tomorrow, or the date.
 * Past it, the word "Overdue" leads, so the red is never the only sign.
 */
function dueLabel(dueAt: string | null, now: Date): { label: string; overdue: boolean; soon: boolean } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const day = toSchoolDateString(due);
  const today = toSchoolDateString(now);
  const tomorrow = toSchoolDateString(new Date(now.getTime() + 86_400_000));
  const when = day === today ? "Today" : day === tomorrow ? "Tomorrow" : formatDate(due);
  const overdue = due.getTime() < now.getTime();
  return { label: overdue ? `Overdue · ${when}` : when, overdue, soon: day === today || day === tomorrow };
}
