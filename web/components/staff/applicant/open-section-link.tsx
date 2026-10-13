"use client";

import { cn } from "@/lib/utils";

/**
 * A link to one of the page's collapsed sections that opens it on the way.
 * A plain `#offer` scrolls to a closed `<details>` and leaves it closed,
 * which reads as a link that did nothing.
 */
export function OpenSectionLink({ target, className, children }: { target: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={`#${target}`}
      className={cn("text-primary underline underline-offset-2", className)}
      onClick={(e) => {
        const el = document.getElementById(target);
        if (!el) return;
        e.preventDefault();
        if (el instanceof HTMLDetailsElement) el.open = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", `#${target}`);
      }}
    >
      {children}
    </a>
  );
}
