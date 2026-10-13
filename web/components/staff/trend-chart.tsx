import { formatDayMonth } from "@/lib/format-date";
import { cn } from "@/lib/utils";

/**
 * Enquiries and enrolments per week, as two small bar charts side by side:
 * the same kind of count, so no dual axis, and a single series each, so no
 * legend; the caption names it. Enquiries are the lighter teal and
 * enrolments the full one, because enrolments are the outcome. Bars are
 * plain HTML so they keep their shape at any width; each is capped at 24px
 * and its whole column is the hover target. The peak is named in the
 * caption rather than printed over a bar, and the breakdown table further
 * down is the table view.
 */
export function TrendChart({ series }: { series: Array<{ week: string; enquiries: number; enrolments: number }> }) {
  if (series.length === 0) return null;
  // "13 Oct … 12 Oct" over the past year reads as one week; the year goes in
  // whenever the weeks cross one.
  const crossesYear = series[0].week.slice(0, 4) !== series[series.length - 1].week.slice(0, 4);
  const weekLabel = (week: string) => (crossesYear ? `${formatDayMonth(week)} ${week.slice(0, 4)}` : formatDayMonth(week));
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 @2xl:grid-cols-2">
        <WeeklyBars series={series} field="enquiries" label="Enquiries" one="enquiry" tone="bg-primary/35" weekLabel={weekLabel} />
        <WeeklyBars series={series} field="enrolments" label="Enrolments" one="enrolment" tone="bg-primary" weekLabel={weekLabel} />
      </div>
    </div>
  );
}

function WeeklyBars({
  series,
  field,
  label,
  one,
  tone,
  weekLabel,
}: {
  series: Array<{ week: string; enquiries: number; enrolments: number }>;
  field: "enquiries" | "enrolments";
  label: string;
  /** The singular, for a week with exactly one. */
  one: string;
  tone: string;
  weekLabel: (week: string) => string;
}) {
  const values = series.map((s) => s[field]);
  const max = Math.max(0, ...values);
  const peak = values.indexOf(max);
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          {max > 0 ? `Peak ${max}, week of ${weekLabel(series[peak].week)}` : "None in this period"}
        </span>
      </figcaption>
      <div
        role="img"
        aria-label={`${label} per week, from the week of ${weekLabel(series[0].week)}: ${values.join(", ")}`}
        // Past about a year the 2px gaps alone would be wider than a narrow
        // chart and squeeze every bar to nothing, so long ranges drop them.
        className={cn("mt-3 flex h-24 items-end border-b border-border", series.length > 60 ? "gap-0" : "gap-0.5")}
      >
        {series.map((s) => {
          const v = s[field];
          return (
            <div key={s.week} className="flex h-full min-w-0 flex-1 items-end justify-center" title={`Week of ${weekLabel(s.week)}: ${v} ${v === 1 ? one : label.toLowerCase()}`}>
              <div
                className={cn("w-full max-w-6 rounded-t-[4px]", tone)}
                style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{weekLabel(series[0].week)}</span>
        <span>{weekLabel(series[series.length - 1].week)}</span>
      </div>
    </figure>
  );
}
