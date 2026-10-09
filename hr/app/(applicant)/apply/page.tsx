import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Circle, Clock } from "lucide-react";
import { ApplicantActionButton } from "@/components/applicant/action-button";
import { SECTION_HINTS, SECTION_TITLES, SECTIONS } from "@/lib/applicant/schemas";
import { loadApplicantView, vacancyIsOpen } from "@/lib/applicant/scope";
import { nextSection, SECTION_MINUTES } from "@/lib/applicant/view-helpers";
import { formatDate } from "@/lib/format-date";
import { requireApplicantSession } from "@/lib/tokens/server";
import { cn } from "@/lib/utils";
import { submitAction, withdrawAction } from "./actions";

export const metadata: Metadata = { title: "Your application" };

/**
 * The applicant's home: seven short sections, done in any order, each with
 * how long it takes and a tick when it is done. The send button appears only
 * when every section is ticked. After sending, the same page says what
 * happens next.
 */
export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ saved?: string; sent?: string }> }) {
  const session = await requireApplicantSession();
  const view = await loadApplicantView(session);
  if (!view) redirect("/apply/link?expired=1");
  const { application, vacancy, campus } = view;
  const { saved } = await searchParams;

  if (application.status !== "draft") {
    return (
      <div className="pb-8">
        <span aria-hidden className="mb-6 block h-1 w-12 rounded-full bg-[var(--brand-mark)]" />
        <h1 className="text-4xl font-semibold tracking-[-0.025em] text-balance">
          {application.status === "withdrawn" ? "You withdrew this application" : "Your application has been sent"}
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          {vacancy.title}, {campus.name}. Reference <span className="font-semibold text-foreground tabular-nums">{application.reference}</span>.
        </p>
        {application.status === "submitted" ? (
          <>
            <ol className="mt-8 space-y-5">
              {[
                ["We have emailed your referees", "They get one short form. We remind them if they forget."],
                ["We read every application after the closing date", vacancy.closes_on ? `The closing date is ${formatDate(vacancy.closes_on)}.` : "We will start soon."],
                ["We email you our decision", "If you are shortlisted, we invite you to an interview."],
              ].map(([title, detail], i) => (
                <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold">{i + 1}</span>
                  <div>
                    <p className="font-semibold">{title}</p>
                    <p className="text-[15px] text-muted-foreground">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-8 text-[15px] text-muted-foreground">You do not need to do anything now. You can close this page.</p>
            <div className="mt-12 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">Changed your mind? You can withdraw your application. We will not contact your referees again.</p>
              <div className="mt-3 w-full sm:w-64">
                <ApplicantActionButton
                  action={withdrawAction}
                  label="Withdraw my application"
                  pendingLabel="Withdrawing…"
                  variant="outline"
                  size="lg"
                  confirm="Withdraw your application? This cannot be undone."
                />
              </div>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  const done = application.sections_completed;
  const count = SECTIONS.filter((s) => done.includes(s)).length;
  const next = nextSection(done);
  const open = vacancyIsOpen(vacancy);

  return (
    <div className="pb-8">
      <p className="text-sm font-medium text-accent-foreground">
        {vacancy.title} · {campus.name}
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-[-0.025em] text-balance">
        {count === 0 ? `Welcome, ${application.first_name}` : count === SECTIONS.length ? "Ready to send" : `${count} of ${SECTIONS.length} sections done`}
      </h1>
      <p className="mt-3 max-w-[60ch] text-[16px] text-muted-foreground text-pretty">
        Your application is saved. Do the sections in any order, and come back with the link in your email whenever you like.
        {vacancy.closes_on ? ` Send it by ${formatDate(vacancy.closes_on)}.` : ""}
      </p>

      <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={SECTIONS.length} aria-valuenow={count} aria-label="Sections done">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none" style={{ width: `${(count / SECTIONS.length) * 100}%` }} />
      </div>

      {saved && SECTIONS.includes(saved as never) ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" aria-hidden /> Saved: {SECTION_TITLES[saved as keyof typeof SECTION_TITLES]}
        </p>
      ) : null}

      <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
        {SECTIONS.map((s) => {
          const isDone = done.includes(s);
          return (
            <li key={s}>
              <Link
                href={`/apply/${s}`}
                className={cn(
                  "group flex items-center gap-4 px-5 py-4 first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                  s === next && "bg-accent/50"
                )}
              >
                {isDone ? <CheckCircle2 className="size-6 shrink-0 text-success" aria-label="Done" /> : <Circle className="size-6 shrink-0 text-muted-foreground/60" aria-label="To do" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{SECTION_TITLES[s]}</span>
                  <span className="block text-sm text-muted-foreground">{SECTION_HINTS[s]}</span>
                </span>
                <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                  <Clock className="size-3.5" aria-hidden /> {SECTION_MINUTES[s]}
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-8">
        {!open ? (
          <p className="rounded-xl bg-muted px-5 py-4 text-[15px]">This vacancy has closed, so the application can no longer be sent.</p>
        ) : next ? (
          <Link
            href={`/apply/${next}`}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground transition-transform hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.97] sm:w-auto"
          >
            {count === 0 ? "Start with " : "Continue with "}
            {SECTION_TITLES[next].toLowerCase()} <ArrowRight className="size-5" aria-hidden />
          </Link>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Send your application</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              When you send it, we email your referees straight away. You cannot change the application after sending.
            </p>
            <div className="mt-4 sm:w-72">
              <ApplicantActionButton action={submitAction} label="Send my application" pendingLabel="Sending…" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
