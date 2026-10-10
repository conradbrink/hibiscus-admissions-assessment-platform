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
    <div className={cn("mb-7 space-y-3", className)}>
      {eyebrow ? (
        <p className="text-[0.71875rem] leading-snug font-semibold tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
      ) : null}
      {/* The website's page title: Poppins ExtraBold, tight, navy. */}
      <h1 className="font-heading text-[1.75rem] leading-[1.08] font-extrabold tracking-[-0.03em] text-navy sm:text-[2.25rem]">
        {title}
      </h1>
      {description ? (
        <p className="text-base leading-[1.7] text-[#4b5563]">{description}</p>
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
