import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 space-y-1.5", className)}>
      {eyebrow ? (
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
      ) : null}
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
      {description ? (
        <p className="text-base leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** "Step 2 of 3" — the only progress indication a parent ever sees. */
export function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-4 flex items-center gap-2" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            i < step ? "bg-primary" : "bg-border"
          )}
        />
      ))}
      <span className="ml-1 text-xs font-medium text-muted-foreground">
        {step}/{total}
      </span>
    </div>
  );
}
