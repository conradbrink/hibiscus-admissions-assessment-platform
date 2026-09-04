import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/parent/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph, loadSiblingApplications } from "@/lib/applications";
import { formatDateLong, formatTime } from "@/lib/format-date";
import { requireParentSession } from "@/lib/tokens/server";
import { isNextAction, NEXT_ACTIONS, STATUS_LABELS } from "@/lib/workflow/states";

export const metadata: Metadata = { title: "Your application" };

/**
 * The hub. One card, one sentence, at most one button. A parent arriving
 * from any email lands here and is told exactly what, if anything, they
 * need to do.
 */
export default async function NextPage() {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const { application: app, campus, grade, intake, booking, contact } = graph;

  if (app.status === "new_enquiry" && app.next_action === null) redirect("/next/grade");

  const siblings = await loadSiblingApplications(admin, contact.id);
  const copy = NEXT_ACTIONS[isNextAction(app.next_action) ? app.next_action : "none"];
  const actionRequired = copy.parentCta !== null;

  return (
    <>
      <PageHeader
        eyebrow={`${app.child_first_name} ${app.child_last_name}`}
        title={`${grade.name} at ${campus.name}`}
        description={`Starting ${intake.label}. Reference ${app.reference}.`}
      />

      <section
        aria-label="Your next step"
        className={
          actionRequired
            ? "rounded-2xl border-2 border-primary bg-card p-5"
            : "rounded-2xl bg-success/10 p-5"
        }
      >
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          {actionRequired ? (
            <span className="text-primary">Your next step</span>
          ) : (
            <>
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              <span className="text-success">Nothing to do right now</span>
            </>
          )}
        </p>
        <h2 className="mt-2 text-xl font-bold">{copy.parentTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{copy.parentDetail}</p>
        {copy.parentCta ? (
          <div className="mt-4">
            <Button size="parent" nativeButton={false} render={<Link href={copy.parentCta.href} />}>
              {copy.parentCta.label}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        ) : null}
      </section>

      {booking ? (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 text-sm">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {booking.kind === "assessment" ? "Assessment" : "Visit"}
          </p>
          <p className="mt-1 font-semibold">
            {formatDateLong(booking.session.starts_at)}, {formatTime(booking.session.starts_at)}
          </p>
          <p className="text-muted-foreground">
            {campus.name}
            {booking.session.location ? `, ${booking.session.location}` : ""}
          </p>
          <Link href="/next/booking" className="mt-2 inline-block font-medium text-primary underline underline-offset-2">
            View or change
          </Link>
        </section>
      ) : null}

      <section className="mt-5 text-sm">
        <p className="text-muted-foreground">
          Status: <span className="font-medium text-foreground">{STATUS_LABELS[app.status]}</span>
        </p>
      </section>

      {siblings.length > 1 ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Your other applications</h2>
          <ul className="space-y-2">
            {siblings
              .filter((s) => s.id !== app.id)
              .map((s) => (
                <li key={s.id} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                  <span className="font-medium">
                    {s.child_first_name} {s.child_last_name}
                  </span>
                  <span className="block text-muted-foreground">
                    {s.grade_name} at {s.campus_name} · {STATUS_LABELS[s.status]}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Each child has their own emails and links. Open the link in that child&rsquo;s email to act on it.
          </p>
        </section>
      ) : null}
    </>
  );
}
