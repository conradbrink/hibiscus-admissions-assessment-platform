import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Clock } from "lucide-react";
import { StartForm } from "@/components/applicant/start-form";
import { BEFORE_YOU_START } from "@/content/careers";
import { formatDate } from "@/lib/format-date";
import { EMPLOYMENT_LABELS, getOpenVacancy, PHASE_LABELS } from "@/lib/recruitment/public";
import { startApplicationAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const v = await getOpenVacancy((await params).slug);
  return { title: v ? `${v.title}, ${v.campus.name}` : "Vacancy" };
}

/** One post: what it is, what it needs, and the three-field start form beside it. */
export default async function VacancyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = await getOpenVacancy(slug);
  if (!v) notFound();
  const paragraphs = v.description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl px-5 pt-10">
      <Link href="/vacancies" className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
        <ArrowLeft className="size-4" aria-hidden /> All posts
      </Link>
      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_400px]">
        <article>
          <p className="text-sm font-medium text-accent-foreground">
            {v.campus.name} · {PHASE_LABELS[v.phase]}
          </p>
          <h1 className="mt-2 text-4xl leading-tight font-semibold tracking-[-0.025em] text-balance sm:text-5xl">{v.title}</h1>
          <dl className="mt-6 grid max-w-xl grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-5 text-sm sm:grid-cols-3">
            <Fact label="Type" value={EMPLOYMENT_LABELS[v.employment_type]} />
            {v.subject ? <Fact label="Subject" value={v.subject} /> : null}
            {v.grade_range ? <Fact label="Grades" value={v.grade_range} /> : null}
            {v.starts_on ? <Fact label="Starts" value={formatDate(v.starts_on)} /> : null}
            <Fact label="Closing date" value={v.closes_on ? formatDate(v.closes_on) : "Open until filled"} />
            {v.salary_note ? <Fact label="Pay" value={v.salary_note} /> : null}
          </dl>
          {v.summary ? <p className="mt-8 max-w-[65ch] text-lg leading-relaxed text-pretty">{v.summary}</p> : null}
          <div className="mt-6 max-w-[68ch] space-y-4 text-[16px] leading-relaxed text-foreground/90">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-pretty whitespace-pre-line">
                {p}
              </p>
            ))}
          </div>
          {v.requirements.length ? (
            <>
              <h2 className="mt-10 text-xl font-semibold tracking-tight">What you need</h2>
              <ul className="mt-4 max-w-[68ch] space-y-2.5">
                {v.requirements.map((r) => (
                  <li key={r} className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <section id="privacy" className="mt-12 max-w-[68ch] rounded-xl bg-muted px-5 py-4 text-sm leading-relaxed text-muted-foreground">
            <h2 className="font-semibold text-foreground">Privacy notice</h2>
            <p className="mt-1">
              Only our Human Resources team and the people who interview you see your application. We use it to decide who to interview and appoint. We ask your referees about your work. We use an AI service (Anthropic) to help mark the written answers and to check whether they were written with an AI tool. It receives your answers, not your name or contact details. A person makes every decision. If you are not appointed, we delete your application 12 months after the decision, or 24 months if you ask us to keep it. You can ask to see or delete your information by replying to any email we send you.
            </p>
          </section>
        </article>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
            <h2 className="text-xl font-semibold tracking-tight">Apply for this post</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden /> About 40 minutes. You can stop and come back.
            </p>
            <div className="mt-5">
              <StartForm action={startApplicationAction.bind(null, v.slug)} />
            </div>
          </div>
          <div className="mt-6 px-1">
            <p className="text-sm font-semibold">Have these ready</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {BEFORE_YOU_START.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
