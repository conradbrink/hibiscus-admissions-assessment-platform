import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The page's records, grouped the way staff think about them: the workflow
 * (what is being done), information (what is on file), history (what has
 * happened). One quiet panel per group, one line per record, each opening in
 * place — so the page reads as three things rather than a dozen equal cards.
 */
export function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className} aria-label={title}>
      <h2 className="mb-1.5 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</h2>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

/**
 * One record in a group: its name, a few words of where it stands, and the
 * detail when opened. A native `<details>`, so it needs no client code, works
 * with the keyboard, and can be opened from a link (see OpenSectionLink).
 */
export function Row({
  id,
  title,
  meta,
  open = false,
  children,
}: {
  id?: string;
  title: string;
  /** Where it stands, in a few words: "3 open", "pending approval · P 1,590". */
  meta?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className="group scroll-mt-24 first:rounded-t-xl last:rounded-b-xl">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 select-none hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="w-32 shrink-0 text-sm font-medium sm:w-40">{title}</span>
        {meta ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{meta}</span> : <span className="flex-1" />}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border/70 px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

/** A labelled block inside the side panel. */
export function PanelBlock({ title, aside, className, children }: { title: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("pt-4 first:pt-0", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </div>
  );
}
