import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterChip = { label: string; href: string; active: boolean; count?: number };

/**
 * A row of quick filters inside a page: links, so a filtered view can be
 * bookmarked and the back button works. The page decides what each one
 * shows; this only draws them.
 */
export function FilterChips({
  label,
  caption,
  chips,
  className,
}: {
  /** What the row is, for a screen reader. */
  label: string;
  /** The same, on screen, where the chips alone would not say. */
  caption?: string;
  chips: FilterChip[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("mb-5 flex flex-wrap items-center gap-1.5", className)}>
      {caption ? <span className="mr-1 text-[13px] text-muted-foreground">{caption}</span> : null}
      {chips.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          aria-current={c.active ? "true" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            c.active ? "border-primary/40 bg-accent font-medium text-accent-foreground" : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
          )}
        >
          {c.label}
          {c.count !== undefined ? <span className="tabular-nums opacity-80">{c.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
