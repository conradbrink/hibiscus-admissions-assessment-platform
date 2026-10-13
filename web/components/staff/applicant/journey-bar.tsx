import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOURNEY, type JourneyStage, type NextStep } from "@/lib/workflow/next-step";

/**
 * Enquiry → Assessment → Decision → Offer → Payment → Registered, with the
 * applicant's place on it. One line, because it is orientation, not a menu:
 * the records from each stage are further down the page.
 *
 * A family who paused or left stops at the stage they reached, marked in
 * grey rather than green, so the bar never claims a step is under way that
 * nobody is working on.
 */
export function JourneyBar({
  stage,
  halted,
  done,
  assessmentLabel,
  skipped = [],
}: {
  stage: JourneyStage;
  halted: NextStep["halted"];
  /** The journey is finished: every step ticked. */
  done: boolean;
  /** "Visit" or "Interview" for a family who does not sit an assessment. */
  assessmentLabel: string;
  /** Steps this family went past without taking: a pre-school child decided with no visit. Never ticked. */
  skipped?: readonly JourneyStage[];
}) {
  const current = JOURNEY.findIndex((s) => s.key === stage);
  return (
    <nav aria-label="Admissions journey" className="mb-5">
      <ol className="grid grid-cols-6 gap-1">
        {JOURNEY.map((s, i) => {
          const state = skipped.includes(s.key) && i !== current ? "todo" : done || i < current ? "done" : i === current ? (halted ? "halted" : "current") : "todo";
          const label = s.key === "assessment" ? assessmentLabel : s.label;
          return (
            <li key={s.key} className="min-w-0" aria-current={state === "current" || state === "halted" ? "step" : undefined}>
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  state === "done" && "bg-primary/70",
                  state === "current" && "bg-primary",
                  state === "halted" && "bg-muted-foreground/40",
                  state === "todo" && "bg-border"
                )}
              />
              <p
                className={cn(
                  "mt-1.5 flex items-center gap-1 truncate text-[11px] font-medium tracking-wide uppercase",
                  state === "current" ? "text-primary" : state === "halted" ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {state === "done" ? <Check className="size-3 shrink-0 text-primary" aria-hidden /> : null}
                <span className="truncate">{label}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
