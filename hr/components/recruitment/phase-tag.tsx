import { PHASE_LABELS } from "@/lib/recruitment/public";
import { cn } from "@/lib/utils";

/**
 * A phase as the school's website shows it: a coloured dot and the name,
 * on a light wash of the same colour. Blue is pre-school, green primary,
 * purple secondary, as on hibiscusschools.com; support staff use orange.
 */
const STYLE = {
  preschool: "bg-phase-preschool/10 text-phase-preschool",
  primary: "bg-phase-primary/10 text-phase-primary",
  secondary: "bg-phase-secondary/10 text-phase-secondary",
  general: "bg-phase-general/10 text-phase-general",
} as const;

export function PhaseTag({ phase, className }: { phase: keyof typeof STYLE; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", STYLE[phase], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {PHASE_LABELS[phase]}
    </span>
  );
}
