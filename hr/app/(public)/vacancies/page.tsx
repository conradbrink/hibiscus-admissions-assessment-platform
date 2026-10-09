import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { BEFORE_YOU_START, CAREERS_HERO, FAQ, PROCESS_STEPS } from "@/content/careers";
import { formatDate } from "@/lib/format-date";
import { EMPLOYMENT_LABELS, listOpenVacancies, PHASE_LABELS } from "@/lib/recruitment/public";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Teach at Hibiscus" };

const PHASES = ["preschool", "primary", "secondary", "general"] as const;

/**
 * The careers page. Read as: a recruitment page for qualified teachers in
 * Botswana and South Africa, often on a phone, in a calm and direct voice,
 * using the school's paper-and-orange brand rather than a marketing
 * template. The vacancies come first after one short promise, because the
 * post is what a teacher came for; the process, the checklist and the
 * answers to the usual worries follow (docs/hr/OBJECTIONS.md).
 */
export default async function VacanciesPage({ searchParams }: { searchParams: Promise<{ phase?: string; campus?: string }> }) {
  const { phase, campus } = await searchParams;
  const all = await listOpenVacancies();
  const campuses = [...new Map(all.map((v) => [v.campus.id, v.campus.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = all.filter((v) => (!phase || v.phase === phase) && (!campus || v.campus.id === campus));
  const filterHref = (next: { phase?: string | null; campus?: string | null }) => {
    const p = new URLSearchParams();
    const ph = next.phase === undefined ? phase : next.phase;
    const ca = next.campus === undefined ? campus : next.campus;
    if (ph) p.set("phase", ph);
    if (ca) p.set("campus", ca);
    const qs = p.toString();
    return `/vacancies${qs ? `?${qs}` : ""}#posts`;
  };

  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-12 sm:pt-24">
        <div className="max-w-3xl">
          <span aria-hidden className="mb-6 block h-1 w-12 rounded-full bg-[var(--brand-mark)]" />
          <h1 className="text-5xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-6xl">{CAREERS_HERO.title}</h1>
          <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-muted-foreground text-pretty">{CAREERS_HERO.lead}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a
              href="#posts"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.97]"
            >
              See open posts <ArrowRight className="size-4" aria-hidden />
            </a>
            <p className="text-sm text-muted-foreground">{CAREERS_HERO.start}</p>
          </div>
        </div>
      </section>

      <section id="posts" className="mx-auto max-w-6xl scroll-mt-6 px-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Open posts <span className="text-muted-foreground tabular-nums">({shown.length})</span>
          </h2>
          <nav aria-label="Filter by phase" className="flex flex-wrap gap-2">
            <FilterChip href={filterHref({ phase: null })} active={!phase}>
              All
            </FilterChip>
            {PHASES.filter((p) => all.some((v) => v.phase === p)).map((p) => (
              <FilterChip key={p} href={filterHref({ phase: p })} active={phase === p}>
                {PHASE_LABELS[p]}
              </FilterChip>
            ))}
          </nav>
        </div>
        {campuses.length > 1 ? (
          <nav aria-label="Filter by school" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={filterHref({ campus: null })} className={cn("py-1", !campus ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>
              Every school
            </Link>
            {campuses.map(([id, name]) => (
              <Link key={id} href={filterHref({ campus: id })} className={cn("py-1", campus === id ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {name}
              </Link>
            ))}
          </nav>
        ) : null}

        {shown.length ? (
          <ul className="mt-2 divide-y divide-border">
            {shown.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/vacancies/${v.slug}`}
                  className="group grid gap-x-6 gap-y-1 rounded-lg py-5 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <p className="text-lg font-semibold tracking-tight group-hover:text-primary">{v.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {v.campus.name} · {PHASE_LABELS[v.phase]}
                      {v.subject ? ` · ${v.subject}` : ""} · {EMPLOYMENT_LABELS[v.employment_type]}
                    </p>
                    {v.summary ? <p className="mt-2 max-w-[70ch] text-[15px] text-foreground/85">{v.summary}</p> : null}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground sm:justify-end">
                    {v.closes_on ? <span>Closes {formatDate(v.closes_on)}</span> : <span>Open until filled</span>}
                    <ArrowRight className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-xl border border-dashed border-border px-5 py-10 text-center text-muted-foreground">
            {all.length ? "No open posts match. Try another phase or school." : "There are no open posts at the moment. Please check again soon."}
          </p>
        )}
      </section>

      <section className="mx-auto mt-24 grid max-w-6xl gap-12 px-5 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-6 space-y-6">
            {PROCESS_STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[2.5rem_1fr] gap-3">
                <span className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold tabular-nums">{i + 1}</span>
                <div>
                  <p className="font-semibold">{step.title}</p>
                  <p className="mt-0.5 text-[15px] text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="self-start rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Before you start, have these ready</h2>
          <ul className="mt-4 space-y-3">
            {BEFORE_YOU_START.map((item) => (
              <li key={item} className="flex gap-3 text-[15px]">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-3xl px-5">
        <h2 className="text-2xl font-semibold tracking-tight">Questions teachers ask</h2>
        <div className="mt-4 divide-y divide-border border-y border-border">
          {FAQ.map((item) => (
            <details key={item.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
                {item.q}
                <span aria-hidden className="text-xl leading-none text-muted-foreground transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
                  +
                </span>
              </summary>
              <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:border-foreground/40"
      )}
    >
      {children}
    </Link>
  );
}
