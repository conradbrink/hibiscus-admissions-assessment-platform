import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { PhaseTag } from "@/components/recruitment/phase-tag";
import { requireStaff } from "@/lib/staff/session";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/12 text-success",
  closed: "bg-warning/30 text-warning-foreground",
  archived: "bg-muted text-muted-foreground",
};

export default async function VacanciesPage() {
  const ctx = await requireStaff("hr.recruitment.read");
  const [{ data: vacancies }, { data: apps }, { data: campuses }] = await Promise.all([
    ctx.supabase.from("hr_vacancies").select("*").neq("status", "archived").order("created_at", { ascending: false }),
    ctx.supabase.from("hr_applications").select("vacancy_id, stage, status").neq("status", "draft"),
    ctx.supabase.from("campuses").select("id, name"),
  ]);
  const campusName = new Map((campuses ?? []).map((c) => [c.id, c.name]));
  const counts = new Map<string, { total: number; review: number; shortlisted: number }>();
  for (const a of apps ?? []) {
    const c = counts.get(a.vacancy_id) ?? { total: 0, review: 0, shortlisted: 0 };
    c.total++;
    if (a.status === "submitted" && a.stage === "review") c.review++;
    if (a.status === "submitted" && a.stage === "shortlisted") c.shortlisted++;
    counts.set(a.vacancy_id, c);
  }
  return (
    <>
      <PageTitle title="Vacancies" description="Draft a post, approve its questions, then publish it to the careers page.">
        {can(ctx.permissions, "hr.recruitment.write") ? (
          <Link href="/staff/recruitment/vacancies/new" className={cn(buttonVariants({ size: "lg" }))}>
            <Plus aria-hidden /> New vacancy
          </Link>
        ) : null}
      </PageTitle>
      {vacancies?.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>School</th>
                <th>Status</th>
                <th>Closes</th>
                <th className="text-right">Applicants</th>
                <th className="text-right">To review</th>
                <th className="text-right">Shortlisted</th>
              </tr>
            </thead>
            <tbody>
              {vacancies.map((v) => {
                const c = counts.get(v.id) ?? { total: 0, review: 0, shortlisted: 0 };
                return (
                  <tr key={v.id}>
                    <td>
                      <Link href={`/staff/recruitment/vacancies/${v.id}`} className="font-medium hover:text-primary hover:underline">
                        {v.title}
                      </Link>
                      <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <PhaseTag phase={v.phase} />
                        {v.subject}
                      </span>
                    </td>
                    <td>{campusName.get(v.campus_id) ?? ""}</td>
                    <td>
                      <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize", STATUS_STYLE[v.status])}>{v.status}</span>
                    </td>
                    <td className="tabular-nums">{v.closes_on ? formatDate(v.closes_on) : "Not set"}</td>
                    <td className="text-right tabular-nums">{c.total}</td>
                    <td className="text-right tabular-nums">
                      {c.review ? (
                        <Link href={`/staff/recruitment/pipeline?vacancy=${v.id}`} className="font-semibold text-primary hover:underline">
                          {c.review}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="text-right tabular-nums">{c.shortlisted}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No vacancies yet. Start with a new one: it begins with the question bank for its phase.</EmptyState>
      )}
    </>
  );
}
