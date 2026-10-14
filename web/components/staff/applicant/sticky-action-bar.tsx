"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The next step, kept in reach. Appears along the bottom of the screen once
 * the Next step card has scrolled out of view, and goes again when it comes
 * back, so the page never shows the main button twice at once.
 *
 * Sticky rather than fixed, so it sits within the page's own column and
 * never covers the console's menu. The contents are rendered on the server.
 */
export function StickyActionBar({ targetId, children }: { targetId: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [targetId]);

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        "sticky bottom-0 z-30 -mx-1 mt-6 pb-3 transition-all duration-200 print:hidden",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card/95 px-4 py-2.5 shadow-lift backdrop-blur supports-[backdrop-filter]:bg-card/85">
        {children}
      </div>
    </div>
  );
}

/** Scrolls back to the Next step card, for a step whose form lives there (a decision, a payment). */
export function JumpToStep({ targetId, label, className }: { targetId: string; label: string; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const el = document.getElementById(targetId);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        // The first control a person would use. Not just "input": the first
        // one in every form is the hidden applicationId, which cannot take
        // focus, and focus left on this button is lost once the bar goes
        // inert. The card itself is the fallback.
        const target =
          el?.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href]'
          ) ?? el;
        if (target === el) el?.setAttribute("tabindex", "-1");
        target?.focus({ preventScroll: true });
      }}
    >
      {label}
    </button>
  );
}
