import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A record kept one click away: a heading that opens. The applicant page puts
 * everything that is not the next step behind one of these, so the page reads
 * as the job first and the history second.
 *
 * A native `<details>`, so it needs no client code, works with the keyboard
 * and can be opened from a link to its id.
 */
export function Section({
  id,
  title,
  meta,
  open = false,
  className,
  children,
}: {
  id?: string;
  title: string;
  /** A count or a few words beside the heading: "3 open", "sent 12 October". */
  meta?: React.ReactNode;
  open?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className={cn("group surface scroll-mt-20", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold">{title}</span>
        {meta ? <span className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span> : null}
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

/** A small card for the side column: a quiet label, then its contents. */
export function SideCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("surface p-4 text-sm", className)}>
      <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
