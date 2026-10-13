import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingDown } from "lucide-react";
import { pct } from "@/lib/analytics/breakdown";
import { delta as change, fmtDelta, shownDirection, type ConversionStep, type ConversionStepKey, type Delta, type FunnelStage, type Share } from "@/lib/analytics/compare";
import { cn } from "@/lib/utils";

/**
 * The analytics pictures: CSS bars, no chart library. Each shows one thing,
 * puts the number beside its bar, and keeps colour for meaning: teal is the
 * data, amber marks the weakest step, green and red say whether a change was
 * good news or bad. Server components; nothing here is interactive beyond
 * links and hover titles.
 */

/**
 * Green for good news, as text. `--success` is a fill colour and reads at
 * 3.7:1 on white, under the 4.5:1 small text needs; this is the same green
 * darkened until it passes.
 */
const GOOD_TEXT = "text-[oklch(0.5_0.13_150)]";

const COUNT = new Intl.NumberFormat("en-GB");

export function fmtCount(n: number): string {
  return COUNT.format(n);
}

/** How a figure moved against the period before: arrow and colour by whether that is good news. */
export function DeltaText({
  delta,
  kind = "count",
  goodWhen = "up",
  compact = false,
  title,
  className,
}: {
  delta: Delta | null;
  kind?: "count" | "fraction" | "days";
  /** Which direction is good news, so the colour says so; "neither" for a figure that is a choice, not a result. */
  goodWhen?: "up" | "down" | "neither";
  /** For a narrow column: a missing comparison is a dash rather than words. */
  compact?: boolean;
  /** On hover: what the figure was before, where the change alone is shown. */
  title?: string;
  className?: string;
}) {
  const direction = shownDirection(delta, kind);
  const moved = direction === "up" || direction === "down";
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight;
  if (!delta && compact) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)} title={title}>
        <span aria-hidden>—</span>
        <span className="sr-only">No comparison with the period before</span>
      </p>
    );
  }
  const text = fmtDelta(delta, kind);
  return (
    <p
      className={cn(
        "flex items-center gap-0.5 text-xs font-medium whitespace-nowrap",
        moved && goodWhen !== "neither" ? (direction === goodWhen ? GOOD_TEXT : "text-destructive") : "text-muted-foreground",
        className
      )}
      title={title}
    >
      {moved ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {text.charAt(0).toUpperCase() + text.slice(1)}
      <span className="sr-only"> against the period before</span>
    </p>
  );
}

/**
 * A headline figure, drawn as one cell of the strip across the top of the
 * page: the label, the number as the loudest thing in it, and how it moved.
 * The cell has no frame of its own; the strip draws the lines between cells.
 */
export function Headline({
  label,
  value,
  unit,
  delta,
  kind = "count",
  goodWhen = "up",
  hint,
}: {
  label: string;
  value: string;
  /** A unit written smaller after the number, such as "days". */
  unit?: string;
  delta: Delta | null;
  kind?: "count" | "fraction" | "days";
  goodWhen?: "up" | "down";
  /** What the figure is measured against; on hover, and read out. */
  hint?: string;
}) {
  return (
    <div className="bg-card px-4 py-3.5" title={hint}>
      <p className="truncate text-[13px] font-medium text-muted-foreground">
        {label}
        {hint ? <span className="sr-only">, {hint}</span> : null}
      </p>
      <p className="mt-1.5 text-[28px] leading-none font-semibold tracking-tight text-foreground">
        {value}
        {unit ? <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">{unit}</span> : null}
      </p>
      <DeltaText className="mt-2" delta={delta} kind={kind} goodWhen={goodWhen} />
    </div>
  );
}

/**
 * The funnel: one bar per stage, each scaled to enquiries, with the count at
 * the end of the bar and the share of enquiries in its own column.
 *
 * Every bar shares one base, so the lengths compare honestly even though the
 * stages are not all one path: booking and assessment count only the routes
 * that have an assessment, and approval counts every route. The step from
 * one stage to the next is on hover; the conversions worth reading as steps
 * have their own list, with the period before beside them.
 */
export function FunnelChart({ stages, highlight }: { stages: FunnelStage[]; highlight?: string | null }) {
  // One row per stage where there is room (label, bar, share); where there is
  // not, the label and share share a line and the bar takes the full width
  // under them, rather than every bar being squeezed to a sliver.
  const row = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 @md:grid-cols-[minmax(7.5rem,10.5rem)_minmax(0,1fr)_4.75rem]";
  return (
    <div className="@container">
      <div className={cn(row, "mb-2 text-xs text-muted-foreground")} aria-hidden>
        <span>Stage</span>
        <span className="hidden @md:block">Families</span>
        <span className="text-right">Of enquiries</span>
      </div>
      <ol className="space-y-2.5 @md:space-y-1.5">
        {stages.map((s) => {
          const weak = s.key === highlight;
          const title = `${s.label}: ${fmtCount(s.count)} families, ${pct(s.ofTop)} of enquiries${s.step === null ? "" : `, ${pct(s.step)} of the stage before`}`;
          return (
            <li key={s.key} className={cn(row, "gap-y-1")} title={title}>
              <span className="truncate text-sm text-foreground">
                {s.label}
                {weak ? <span className="sr-only"> (reached through the weakest step)</span> : null}
              </span>
              <span className="relative order-last col-span-2 flex h-6 min-w-0 items-center @md:order-none @md:col-span-1">
                {/* The whole of enquiries, faintly, so each bar reads as a share of it. */}
                <span className="absolute inset-y-0 right-14 left-0 rounded-r-[4px] bg-muted/70" aria-hidden />
                <span
                  className={cn("relative h-full shrink-0 rounded-r-[4px]", weak ? "bg-warning/75" : "bg-primary")}
                  style={{ width: `max(2px, calc(${s.ofTop ?? 0} * (100% - 3.5rem)))` }}
                  aria-hidden
                />
                <span className="relative pl-2 text-sm font-medium text-foreground tabular-nums">{fmtCount(s.count)}</span>
              </span>
              <span className="text-right text-sm text-muted-foreground tabular-nums">{pct(s.ofTop)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Each step's conversion as a figure, a thin bar and the change since the
 * period before; the weakest step is marked, with the way to the families
 * stuck at it. A step's label links to the same list where one exists.
 */
export function StepList({
  steps,
  weakest,
  links,
}: {
  steps: ConversionStep[];
  weakest: ConversionStepKey | null;
  links?: Partial<Record<ConversionStepKey, { href: string; label: string }>>;
}) {
  return (
    <ol className="divide-y divide-border/70">
      {steps.map((s) => {
        const weak = s.key === weakest;
        const link = links?.[s.key];
        return (
          <li key={s.key} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              {link ? (
                <Link href={link.href} title={link.label} className="min-w-0 flex-1 truncate text-sm text-foreground underline-offset-4 hover:text-primary hover:underline">
                  {s.label}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.label}</span>
              )}
              <span className="text-sm font-semibold text-foreground tabular-nums">{pct(s.rate)}</span>
              <DeltaText
                className="w-[4.75rem] justify-end text-right"
                delta={change(s.rate, s.previous, "fraction")}
                kind="fraction"
                goodWhen={s.chosenBySchool ? "neither" : "up"}
                compact
                title={s.previous === null ? undefined : `${pct(s.previous)} in the period before`}
              />
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn("h-full rounded-full", weak ? "bg-warning/75" : "bg-primary/60")} style={{ width: `${Math.round((s.rate ?? 0) * 100)}%` }} />
            </div>
            {weak ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                  <TrendingDown className="size-3" aria-hidden />
                  Weakest step
                </span>
                {link ? (
                  <Link href={link.href} className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
                    {link.label}
                    <ArrowRight className="size-3" aria-hidden />
                  </Link>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Rows as a quiet bar behind the label, scaled to the largest row, with the
 * enquiries and the share of them that enrolled in two columns at the end.
 */
export function BarList({ rows, max = 8 }: { rows: Share[]; max?: number }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  const shown = rows.slice(0, max);
  const rest = rows.slice(max);
  const restCount = rest.reduce((n, r) => n + r.count, 0);
  return (
    <div>
      <div className="mb-1 flex gap-3 px-2 text-xs text-muted-foreground" aria-hidden>
        <span className="flex-1" />
        <span className="w-16 text-right">Enquiries</span>
        <span className="w-14 text-right">Enrolled</span>
      </div>
      <ul className="space-y-1">
        {shown.map((r) => (
          <li key={r.key} className="relative flex h-8 items-center gap-3 px-2" title={`${r.label}: ${fmtCount(r.count)} enquiries, ${pct(r.share)} of all; ${pct(r.enquiryToEnrolment)} enrolled`}>
            <span className="absolute inset-y-0 left-0 rounded-[4px] bg-primary/10" style={{ width: `${(r.count / top) * 100}%` }} aria-hidden />
            <span className="relative min-w-0 flex-1 truncate text-sm text-foreground">
              {r.label}
              <span className="sr-only">, {pct(r.share)} of enquiries</span>
            </span>
            <span className="relative w-16 text-right text-sm font-medium text-foreground tabular-nums">{fmtCount(r.count)}</span>
            <span className="relative w-14 text-right text-sm text-muted-foreground tabular-nums">{pct(r.enquiryToEnrolment)}</span>
          </li>
        ))}
      </ul>
      {rest.length ? (
        <p className="mt-2 px-2 text-xs text-muted-foreground">
          And {rest.length} more, with {fmtCount(restCount)} {restCount === 1 ? "enquiry" : "enquiries"}
        </p>
      ) : null}
    </div>
  );
}

/** Committed against capacity, with the expected extra shown lighter and a capacity line. */
export function FillBar({ committed, expected, capacity }: { committed: number; expected: number; capacity: number | null }) {
  if (capacity === null || capacity === 0) {
    return <span className="text-xs text-muted-foreground">no capacity set</span>;
  }
  const scale = Math.max(capacity, expected, committed);
  const w = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const over = expected > capacity;
  return (
    <span className="relative block h-5 overflow-hidden rounded-md bg-muted/60" title={`${committed} committed, ${expected} expected, capacity ${capacity}`}>
      <span className={cn("absolute inset-y-0 left-0 rounded-md", over ? "bg-warning/60" : "bg-success/35")} style={{ width: w(expected) }} aria-hidden />
      <span className={cn("absolute inset-y-0 left-0 rounded-md", over ? "bg-warning" : "bg-success/85")} style={{ width: w(committed) }} aria-hidden />
      <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: w(capacity) }} aria-hidden />
    </span>
  );
}

/** A percentage as a short bar with the figure, for table cells. */
export function PctBar({ value, tone = "primary" }: { value: number | null; tone?: "primary" | "success" | "warning" }) {
  const cls = { primary: "bg-primary/70", success: "bg-success/70", warning: "bg-warning" }[tone];
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-2 w-16 overflow-hidden rounded bg-muted/70">
        <span className={cn("absolute inset-y-0 left-0 rounded", cls)} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} aria-hidden />
      </span>
      <span className="tabular-nums">{pct(value)}</span>
    </span>
  );
}
