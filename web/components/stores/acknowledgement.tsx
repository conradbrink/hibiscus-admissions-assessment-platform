"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { StoresSignaturePad } from "@/components/stores/signature-pad";
import type { Drawing } from "@/lib/stores/signature";

export type AckLine = { key: string; text: string; detail?: string };

/**
 * The screen the employee reads and signs, over everything else: no menu, no
 * bottom bar, nothing to tap but the box and the buttons. What they see is
 * exactly what is stored with their signature: their name, the items and
 * quantities, the dates, the conditions on a return, and the school's words.
 *
 * The storekeeper's Back is small and at the top; Confirm, which is theirs
 * too, is at the foot and stays off until there is a signature.
 */
export function AcknowledgementScreen({
  title,
  facts,
  linesLabel,
  lines,
  after,
  acknowledgement,
  onBack,
  onDrawing,
  onConfirm,
  confirmLabel,
  pending,
  error,
  signed,
}: {
  title: string;
  facts: Array<{ label: string; value: string }>;
  linesLabel: string;
  lines: AckLine[];
  after?: React.ReactNode;
  acknowledgement: string;
  onBack: () => void;
  onDrawing: (d: Drawing | null) => void;
  onConfirm: () => void;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  signed: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // The page under the overlay must not scroll with it on a phone, and must
  // not be reachable at all: `inert` takes it out of the tab order and away
  // from a screen reader, so Tab cannot walk the employee into the menu
  // behind the signing screen. Focus starts on the screen itself.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const shell = document.querySelector<HTMLElement>(".staff-shell");
    const wasInert = shell?.hasAttribute("inert") ?? false;
    shell?.setAttribute("inert", "");
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      if (shell && !wasInert) shell.removeAttribute("inert");
    };
  }, []);

  // Escape is the storekeeper's Back, except while saving.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack, pending]);

  // Rendered at the foot of the page, outside the app shell, so making the
  // shell inert does not take the signing screen with it.
  return createPortal(
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-background outline-none" role="dialog" aria-modal="true" aria-labelledby="ack-title">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={onBack} disabled={pending} className="inline-flex h-11 items-center gap-1 rounded-lg pr-3 text-sm font-medium text-primary hover:bg-muted disabled:opacity-50">
            <ChevronLeft className="size-4" aria-hidden /> Back
          </button>
          <Logo className="h-7 w-auto" priority={false} />
        </div>

        <div className="surface flex-1 space-y-4 p-4 sm:p-6">
          <h1 id="ack-title" className="text-center text-[13px] leading-snug font-bold tracking-wide text-foreground uppercase sm:text-sm">{title}</h1>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {facts.map((f) => (
              <div key={f.label} className="flex justify-between gap-3 border-b border-border/60 pb-1.5 sm:block sm:border-0 sm:pb-0">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="text-right font-semibold text-foreground sm:text-left">{f.value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <p className="mb-1.5 text-sm text-muted-foreground">{linesLabel}</p>
            <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
              {lines.map((l) => (
                <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2.5">
                  <span className="text-base font-semibold text-foreground">{l.text}</span>
                  {l.detail ? <span className="text-sm text-muted-foreground">{l.detail}</span> : null}
                </li>
              ))}
            </ul>
            {after}
          </div>

          <blockquote className="rounded-xl bg-accent/60 px-4 py-3 text-[15px] leading-relaxed text-foreground">“{acknowledgement}”</blockquote>

          <div>
            <p className="mb-1.5 text-sm font-medium">Employee signature</p>
            <StoresSignaturePad onChange={onDrawing} disabled={pending} />
          </div>

          {error ? <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
        </div>

        <Button type="button" onClick={onConfirm} disabled={!signed || pending} className="mt-4 h-14 w-full text-base font-semibold">
          {pending ? "Saving…" : signed ? confirmLabel : "Waiting for the signature"}
        </Button>
      </div>
    </div>,
    document.body
  );
}
