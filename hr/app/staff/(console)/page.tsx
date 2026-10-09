import Link from "next/link";
import { CalendarClock, CalendarDays, Inbox, Megaphone, ShieldAlert, Star, UserRoundSearch, Wallet } from "lucide-react";
import { FlagChips, ScoreBadge } from "@/components/recruitment/badges";
import { PageTitle } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { formatDate, formatDateTime, hoursAgoIso } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { FLAG_META } from "@/lib/scoring/flags";
import { requireStaff, type StaffContext } from "@/lib/staff/session";
import { expiringSoon } from "@/lib/employees";
import { periodLabel } from "@/lib/payroll/period";

/**
 * What needs a person today: new applications to read, references still out,
 * anything with a red flag, and this week's interviews. Everything is read
 * through the staff member's own client, so a campus-restricted principal
 * sees their campus only.
 */
export default async function DashboardPage() {
  const ctx = await requireStaff();
  const first = (ctx.profile.full_name || ctx.profile.email).split(/[\s@]/)[0];
  if (!can(ctx.permissions, "hr.recruitment.read")) {
    return (
      <>
        <PageTitle title={`Good to see you, ${first}`} description="What needs you today. Your HR pages are in the menu on the left." />
        <PeopleAndPay ctx={ctx} />
      </>
    );
  }
  const s = ctx.supabase;
  const now = hoursAgoIso(0);
  const weekAhead = hoursAgoIso(-7 * 24);
  const critical = Object.entries(FLAG_META).filter(([, m]) => m.severity === "critical").map(([code]) => code);

  const [vacancies, review, shortlisted, refsOut, flagged, interviews] = await Promise.all([
    s.from("hr_vacancies").select("id", { count: "exact", head: true }).eq("status", "published"),
    s.from("hr_applications").select("id", { count: "exact", head: true }).eq("status", "submitted").eq("stage", "review"),
    s.from("hr_applications").select("id", { count: "exact", head: true }).eq("status", "submitted").eq("stage", "shortlisted"),
    s.from("hr_reference_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "sent", "opened"]),
    s
      .from("hr_applications")
      .select("id, reference, first_name, last_name, score_total, score_available, score_flags, vacancy_id")
      .eq("status", "submitted")
      .neq("stage", "unsuccessful")
      .overlaps("score_flags", critical)
      .order("submitted_at", { ascending: false })
      .limit(8),
    s.from("hr_interviews").select("id, application_id, starts_at, mode").eq("status", "scheduled").gte("starts_at", now).lte("starts_at", weekAhead).order("starts_at").limit(10),
  ]);

  const appIds = [...new Set((interviews.data ?? []).map((i) => i.application_id))];
  const { data: interviewApps } = appIds.length ? await s.from("hr_applications").select("id, first_name, last_name").in("id", appIds) : { data: [] };
  const names = new Map((interviewApps ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));

  return (
    <>
      <PageTitle title={`Good to see you, ${first}`} description="What needs you today. Everything here is a click away." />
      <PeopleAndPay ctx={ctx} />
      <h2 className="mb-3 text-lg font-semibold">Recruitment</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Open vacancies" value={vacancies.count ?? 0} icon={Megaphone} href="/staff/recruitment/vacancies" />
        <StatTile label="To review" value={review.count ?? 0} icon={Inbox} tone="info" href="/staff/recruitment/pipeline" />
        <StatTile label="Shortlisted" value={shortlisted.count ?? 0} icon={Star} tone="success" href="/staff/recruitment/pipeline" />
        <StatTile label="References out" value={refsOut.count ?? 0} icon={UserRoundSearch} tone="warning" />
        <StatTile label="Red flags" value={flagged.data?.length ?? 0} icon={ShieldAlert} tone="destructive" hint="Need a person to read" />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section className="surface p-5">
          <h2 className="font-semibold">Red flags to read</h2>
          <p className="text-sm text-muted-foreground">A flag never changes the score. Someone senior should read each one.</p>
          {flagged.data?.length ? (
            <ul className="mt-4 divide-y divide-border/70">
              {flagged.data.map((a) => (
                <li key={a.id}>
                  <Link href={`/staff/recruitment/applications/${a.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg py-3 hover:bg-muted/50">
                    <span>
                      <span className="font-medium">
                        {a.first_name} {a.last_name}
                      </span>{" "}
                      <span className="text-xs text-muted-foreground tabular-nums">{a.reference}</span>
                      <span className="mt-1 block">
                        <FlagChips codes={a.score_flags.filter((f) => critical.includes(f))} />
                      </span>
                    </span>
                    <ScoreBadge total={a.score_total} available={a.score_available} flagged />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Nothing flagged. Good.</p>
          )}
        </section>
        <section className="surface p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="size-4 text-primary" aria-hidden /> Interviews in the next 7 days
          </h2>
          {interviews.data?.length ? (
            <ul className="mt-4 divide-y divide-border/70">
              {interviews.data.map((i) => (
                <li key={i.id}>
                  <Link href={`/staff/recruitment/applications/${i.application_id}`} className="flex items-center justify-between gap-3 rounded-lg py-3 hover:bg-muted/50">
                    <span className="font-medium">{names.get(i.application_id) ?? "Applicant"}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">{formatDateTime(i.starts_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No interviews booked this week.</p>
          )}
        </section>
      </div>
    </>
  );
}

/** Leave to decide, payroll to approve, and dates coming up: contracts, probations, registrations and permits. */
async function PeopleAndPay({ ctx }: { ctx: StaffContext }) {
  const may = {
    employees: can(ctx.permissions, "hr.employees.read"),
    leave: can(ctx.permissions, "hr.leave.approve"),
    payroll: can(ctx.permissions, "hr.payroll.read"),
  };
  if (!may.employees && !may.leave && !may.payroll) return null;
  const s = ctx.supabase;
  const none = Promise.resolve({ data: null, count: null });
  const [leave, runs, coming] = await Promise.all([
    may.leave ? s.from("hr_leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending") : none,
    may.payroll ? s.from("hr_payroll_runs").select("id, period, campus_id").eq("status", "calculated").order("period") : none,
    may.employees ? expiringSoon(s, 60) : Promise.resolve([]),
  ]);
  const waiting = runs.data ?? [];
  return (
    <div className="mb-8 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid grid-cols-2 content-start gap-3">
        {may.leave ? <StatTile label="Leave to decide" value={leave.count ?? 0} icon={CalendarDays} tone="warning" href="/staff/leave" /> : null}
        {may.payroll ? (
          <StatTile
            label="Payroll to approve"
            value={waiting.length}
            icon={Wallet}
            tone="warning"
            href={waiting.length === 1 ? `/staff/payroll/runs/${waiting[0].id}` : "/staff/payroll"}
            hint={waiting.length ? waiting.map((r) => periodLabel(r.period)).join(", ") : undefined}
          />
        ) : null}
      </div>
      {may.employees ? (
        <section className="surface p-5">
          <h2 className="font-semibold">Coming up in the next 60 days</h2>
          {coming.length ? (
            <ul className="mt-3 divide-y divide-border/70">
              {coming.slice(0, 8).map((c, i) => (
                <li key={i}>
                  <Link href={`/staff/employees/${c.employeeId}`} className="flex items-center justify-between gap-3 rounded-lg py-2.5 hover:bg-muted/50">
                    <span>
                      <span className="font-medium">{c.name}</span> <span className="text-sm text-muted-foreground">{c.what.toLowerCase()}</span>
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">{formatDate(c.on)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No contracts, probations, registrations or permits end in the next 60 days.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
