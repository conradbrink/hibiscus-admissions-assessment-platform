import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, ListChecks } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { VacancyForm } from "@/components/recruitment/vacancy-form";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { accessibleCampuses } from "@/lib/recruitment/campuses";
import { requireStaff } from "@/lib/staff/session";
import { cn } from "@/lib/utils";
import { publishVacancyAction, setVacancyStatusAction, updateVacancyAction } from "../../actions";

export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("hr.recruitment.read");
  const { data: v } = await ctx.supabase.from("hr_vacancies").select("*").eq("id", id).maybeSingle();
  if (!v) notFound();
  const [campuses, { data: questions }] = await Promise.all([
    accessibleCampuses(ctx.supabase),
    ctx.supabase.from("hr_vacancy_questions").select("status").eq("vacancy_id", v.id),
  ]);
  const approved = (questions ?? []).filter((q) => q.status === "approved").length;
  const drafts = (questions ?? []).length - approved;
  const canWrite = can(ctx.permissions, "hr.recruitment.write");
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

  return (
    <>
      <PageTitle title={v.title} description={v.status === "draft" ? "A draft. Approve the questions, then publish it." : `Published ${formatDate(v.published_at)}.`} back={{ href: "/staff/recruitment/vacancies", label: "Vacancies" }}>
        <Link href={`/staff/recruitment/vacancies/${v.id}/questions`} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          <ListChecks aria-hidden /> Questions ({approved} approved{drafts ? `, ${drafts} draft` : ""})
        </Link>
        {v.status === "published" ? (
          <a href={`${site}/vacancies/${v.slug}`} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            <ExternalLink aria-hidden /> View on the careers page
          </a>
        ) : null}
      </PageTitle>

      {canWrite ? (
        <div className="surface mb-6 flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {v.status === "draft" ? "Ready to publish?" : v.status === "published" ? "Taking applications" : v.status === "closed" ? "Closed to new applications" : "Archived"}
            </p>
            <p className="text-sm text-muted-foreground">
              {v.status === "draft"
                ? "Publishing freezes the questions and the scoring weights, so every applicant is marked the same way."
                : v.status === "published"
                  ? `Applicants can apply until ${v.closes_on ? formatDate(v.closes_on) : "you close it"}.`
                  : "Applicants already in the pipeline are not affected."}
            </p>
          </div>
          {v.status === "draft" ? <ActionForm action={publishVacancyAction.bind(null, v.id)} label="Publish" size="lg" /> : null}
          {v.status === "published" ? <ActionForm action={setVacancyStatusAction.bind(null, v.id, "closed")} label="Close now" variant="outline" size="lg" confirm="Close this vacancy to new applications?" /> : null}
          {v.status === "closed" ? (
            <>
              <ActionForm action={setVacancyStatusAction.bind(null, v.id, "published")} label="Reopen" variant="outline" size="lg" />
              <ActionForm action={setVacancyStatusAction.bind(null, v.id, "archived")} label="Archive" variant="ghost" size="lg" />
            </>
          ) : null}
        </div>
      ) : null}

      <VacancyForm
        action={updateVacancyAction.bind(null, v.id)}
        campuses={campuses}
        submitLabel="Save changes"
        phaseLocked={v.status !== "draft"}
        initial={{
          campus_id: v.campus_id,
          title: v.title,
          phase: v.phase,
          subject: v.subject ?? "",
          grade_range: v.grade_range ?? "",
          employment_type: v.employment_type,
          summary: v.summary,
          description: v.description,
          requirements: v.requirements.join("\n"),
          salary_note: v.salary_note ?? "",
          starts_on: v.starts_on ?? "",
          closes_on: v.closes_on ?? "",
        }}
      />
    </>
  );
}
