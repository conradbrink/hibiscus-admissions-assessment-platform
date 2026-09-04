import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";
import { BAND_LABELS } from "@/lib/assessment/bands";
import { loadApplicationGraph } from "@/lib/applications";
import { formatDateLong } from "@/lib/format-date";
import { loadVisibleProfile } from "@/lib/profile/load";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "Learning profile" };

/**
 * The learning profile, on a phone. Everything numeric came from the
 * scores; the prose either passed the validator or is the standard wording.
 */
export default async function ProfilePage() {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const visible = await loadVisibleProfile(admin, graph.application);
  if (!visible) notFound();
  const { computed, narrative, profile } = visible;
  const child = graph.application.child_first_name;

  return (
    <>
      <PageHeader
        eyebrow="Learning profile"
        title={`${child} ${graph.application.child_last_name}`}
        description={`${graph.grade.name} at ${graph.campus.name} · ${formatDateLong(profile.published_at ?? profile.created_at)}`}
      />

      {computed.overall ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Overall</p>
          <p className="mt-1 text-5xl font-bold tabular-nums">{computed.overall.percent}%</p>
          <p className="text-sm text-muted-foreground">{BAND_LABELS[computed.overall.band]}</p>
        </section>
      ) : null}

      <section className="mt-5 text-base leading-relaxed">
        <p>{narrative.summary}</p>
      </section>

      {computed.strengths.length ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold tracking-wide text-success uppercase">Strengths</h2>
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
            {computed.strengths.map((x) => (
              <li key={x.id} className="flex items-center justify-between px-4 py-3"><span>{x.name}</span><span className="font-semibold tabular-nums">{x.percent}%</span></li>
            ))}
          </ul>
          {narrative.strengths_text ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{narrative.strengths_text}</p> : null}
        </section>
      ) : null}

      {computed.development.length ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold tracking-wide text-warning-foreground uppercase">Areas for development</h2>
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
            {computed.development.map((x) => (
              <li key={x.id} className="flex items-center justify-between px-4 py-3"><span>{x.name}</span><span className="font-semibold tabular-nums">{x.percent}%</span></li>
            ))}
          </ul>
          {narrative.development_text ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{narrative.development_text}</p> : null}
          {computed.focus.length ? (
            <div className="mt-3 rounded-2xl bg-primary/10 p-4">
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">Recommended focus</p>
              <ol className="mt-1 list-decimal pl-5 text-sm">
                {computed.focus.map((f, i) => <li key={i}>{f}</li>)}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">All results</h2>
        <div className="mt-2 rounded-2xl border border-border bg-card">
          {computed.subjects.map((sub) => (
            <div key={sub.id} className="border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex items-center justify-between font-semibold"><span>{sub.name}</span><span className="tabular-nums">{sub.percent}%</span></div>
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {computed.competencies.filter((c) => c.subjectId === sub.id).map((c) => (
                  <li key={c.id} className="flex items-center justify-between"><span>{c.name}</span><span className="tabular-nums">{c.percent}% · {BAND_LABELS[c.band]}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6">
        <Button size="parent" variant="outline" nativeButton={false} render={<Link href="/profile/pdf" prefetch={false} />}>
          <Download data-icon="inline-start" /> Download as PDF
        </Button>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        This profile summarises an academic assessment of English, Mathematics and reasoning skills on one day. It is not a psychological, clinical or diagnostic assessment and makes no claim about ability or any condition. Percentages are marks earned out of marks available.
      </p>
      <p className="mt-3 text-sm"><Link href="/next" className="font-medium text-primary underline underline-offset-2">Back to your application</Link></p>
    </>
  );
}
