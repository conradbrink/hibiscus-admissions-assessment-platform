import { Check } from "lucide-react";
import { formatDate, formatDayMonth } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { JOURNEY, type JourneyStage, type Milestone, type NextStep } from "@/lib/workflow/next-step";

/**
 * Enquiry → Assessment → Decision → Offer → Payment → Registered, with the
 * applicant's place on it: ✓ done, ● now, ○ still to come. Under each done
 * stage, the day it was reached; under the bar, the last thing that happened
 * and who did it ("Accepted · 13 Oct 2026 · Fiona Makopola").
 *
 * A family who paused or left stops at the stage they reached, in grey
 * rather than green, so the bar never claims a step is under way that nobody
 * is working on. A step a family went past without taking (a pre-school
 * child decided with no visit) is never ticked.
 */
export function JourneyBar({
  stage,
  halted,
  done,
  assessmentLabel,
  skipped = [],
  milestones = {},
}: {
  stage: JourneyStage;
  halted: NextStep["halted"];
  /** The journey is finished: every step ticked. */
  done: boolean;
  /** "Visit" or "Interview" for a family who does not sit an assessment. */
  assessmentLabel: string;
  skipped?: readonly JourneyStage[];
  milestones?: Partial<Record<JourneyStage, Milestone>>;
}) {
  const current = JOURNEY.findIndex((s) => s.key === stage);
  const states = JOURNEY.map((s, i) =>
    skipped.includes(s.key) && i !== current ? "todo" : done || i < current ? "done" : i === current ? (halted ? "halted" : "current") : "todo"
  );
  // The most recent stage with something recorded against it.
  const latest = [...JOURNEY]
    .reverse()
    .map((s) => ({ key: s.key, m: milestones[s.key] }))
    .find((x) => x.m && states[JOURNEY.findIndex((s) => s.key === x.key)] !== "todo");

  return (
    <nav aria-label="Admissions journey" className="mb-6">
      <ol className="grid grid-cols-6 gap-1.5">
        {JOURNEY.map((s, i) => {
          const state = states[i];
          const label = s.key === "assessment" ? assessmentLabel : s.label;
          const m = milestones[s.key];
          return (
            <li key={s.key} className="min-w-0" aria-current={state === "current" || state === "halted" ? "step" : undefined}>
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "current" && "ring-4 ring-primary/15 bg-primary",
                    state === "halted" && "bg-muted-foreground/50",
                    state === "todo" && "border border-input bg-card"
                  )}
                >
                  {state === "done" ? <Check className="size-3" strokeWidth={3} /> : state === "current" || state === "halted" ? <span className="size-1.5 rounded-full bg-white" /> : null}
                </span>
                <span className={cn("h-0.5 flex-1 rounded-full", i === JOURNEY.length - 1 ? "invisible" : states[i + 1] === "todo" || state === "todo" ? "bg-border" : "bg-primary/60")} />
              </div>
              <p
                className={cn(
                  "mt-1.5 truncate text-[11px] font-semibold tracking-wide uppercase",
                  state === "current" ? "text-primary" : state === "halted" ? "text-foreground" : state === "done" ? "text-foreground/80" : "text-muted-foreground"
                )}
              >
                <span className="sr-only">{state === "done" ? "Done: " : state === "current" ? "Now: " : state === "halted" ? "Stopped here: " : "To come: "}</span>
                {label}
              </p>
              {m && state !== "todo" ? <p className="truncate text-[11px] text-muted-foreground">{formatDayMonth(m.at)}</p> : null}
            </li>
          );
        })}
      </ol>
      {latest?.m ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{latest.m.label}</span> · {formatDate(latest.m.at)}
          {latest.m.by ? ` · ${latest.m.by}` : ""}
        </p>
      ) : null}
    </nav>
  );
}
