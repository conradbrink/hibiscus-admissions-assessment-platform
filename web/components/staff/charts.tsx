import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { pct } from "@/lib/analytics/breakdown";
import { fmtDelta, type Delta } from "@/lib/analytics/compare";
import { cn } from "@/lib/utils";

/**
 * The analytics pictures: inline SVG and CSS bars, no chart library. Each
 * shows one thing, labels the number beside the bar, and reads in light
 * and dark. Server components; nothing here is interactive.
 */

/** A headline figure with how it moved against the previous period. */
export function Headline({
  label,
  value,
  delta,
  kind = "count",
  goodWhen = "up",
  hint,
}: {
  label: string;
  value: string | number;
  delta: Delta | null;
  kind?: "count" | "fraction" | "days";
  /** Which direction is good news, so the colour says so. */
  goodWhen?: "up" | "down";
  hint?: string;
}) {
  const good = delta && delta.direction !== "flat" ? delta.direction === goodWhen : null;
  const Icon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div className="surface px-4 py-4">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className={cn("mt-1 flex items-center gap-1 text-xs tabular-nums", good === true ? "text-success" : good === false ? "text-destructive" : "text-muted-foreground")}>
        <Icon className="size-3.5" aria-hidden />
        {fmtDelta(delta, kind)}
        <span className="text-muted-foreground"> vs previous period</span>
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Stages as bars scaled to the first, with share of the top and step conversion beside each. */
export function FunnelChart({ stages }: { stages: Array<{ key: string; label: string; count: number; ofTop: number | null; step: number | null }> }) {
  const top = Math.max(1, stages[0]?.count ?? 1);
  return (
    <ol className="space-y-2">
      {stages.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,3fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{s.label}</span>
          <span className="relative h-6 overflow-hidden rounded-md bg-muted/60">
            <span className="absolute inset-y-0 left-0 rounded-md bg-primary/80" style={{ width: `${Math.max(1, (s.count / top) * 100)}%` }} aria-hidden />
            <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold text-primary-foreground mix-blend-difference">{s.count}</span>
          </span>
          <span className="w-36 text-right text-xs tabular-nums">
            <span className="font-medium">{pct(s.ofTop)}</span>
            <span className="text-muted-foreground"> of enquiries{i > 0 ? ` · ${pct(s.step)} step` : ""}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Rows as horizontal bars: a share of the whole, with a second figure at the end. */
export function BarList({
  rows,
  secondaryLabel = "enquiry → enrolment",
  max = 8,
}: {
  rows: Array<{ key: string; label: string; count: number; share: number | null; enrolled: number; enquiryToEnrolment: number | null }>;
  secondaryLabel?: string;
  max?: number;
}) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  const shown = rows.slice(0, max);
  const rest = rows.slice(max);
  const restCount = rest.reduce((n, r) => n + r.count, 0);
  return (
    <ul className="space-y-2 text-sm">
      {shown.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,3fr)_auto] items-center gap-3">
          <span className="truncate">{r.label}</span>
          <span className="relative h-5 overflow-hidden rounded-md bg-muted/60">
            <span className="absolute inset-y-0 left-0 rounded-md bg-info/70" style={{ width: `${(r.count / top) * 100}%` }} aria-hidden />
          </span>
          <span className="w-44 text-right text-xs tabular-nums">
            <span className="font-medium">{r.count}</span> <span className="text-muted-foreground">({pct(r.share)})</span>
            <span className="text-muted-foreground"> · {pct(r.enquiryToEnrolment)} {secondaryLabel}</span>
          </span>
        </li>
      ))}
      {rest.length ? <li className="text-xs text-muted-foreground">and {rest.length} more ({restCount})</li> : null}
    </ul>
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
