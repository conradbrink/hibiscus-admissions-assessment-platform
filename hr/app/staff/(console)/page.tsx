import Link from "next/link";
import { CalendarClock, Inbox, Megaphone, ShieldAlert, Star, UserRoundSearch } from "lucide-react";
import { FlagChips, ScoreBadge } from "@/components/recruitment/badges";
import { PageTitle } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { formatDateTime, hoursAgoIso } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { FLAG_META } from "@/lib/scoring/flags";
import { requireStaff } from "@/lib/staff/session";

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
    return <PageTitle title={`Welcome, ${first}`} description="Your HR pages are in the menu on the left." />;
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
      <PageTitle title={`Good to see you, ${first}`} description="Recruitment at a glance. Everything here is a click away from the applicant." />
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
