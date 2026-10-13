"use client";

import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The page's detail panels — the offer editor, the letter as the parent
 * reads it — rendered once and opened from any button that names them.
 *
 * The same "Edit offer" appears in the Next step card, the Offer record and
 * the sticky bar. Each used to carry its own copy of the dialog, so the
 * letter's HTML and every editor form went to the browser three times. Now
 * the host holds one copy of each and the buttons only say which to open.
 *
 * The contents are rendered on the server and passed in, so the forms inside
 * are the same server actions as anywhere else. A panel stays open after a
 * save, showing the updated values, until it is closed.
 */

export type PanelSpec = { title: string; description?: string; wide?: boolean; content: React.ReactNode };

const OpenPanel = createContext<(name: string) => void>(() => {});

export function PanelHost({ panels, children }: { panels: Record<string, PanelSpec | null>; children: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <OpenPanel.Provider value={setOpen}>
      {children}
      {Object.entries(panels).map(([name, spec]) =>
        spec ? (
          <Dialog key={name} open={open === name} onOpenChange={(o) => setOpen(o ? name : null)}>
            <DialogContent className={cn("max-h-[85dvh] overflow-y-auto", spec.wide ? "sm:max-w-3xl" : "sm:max-w-2xl")}>
              <DialogHeader>
                <DialogTitle>{spec.title}</DialogTitle>
                {spec.description ? <DialogDescription>{spec.description}</DialogDescription> : null}
              </DialogHeader>
              <div className="text-sm">{spec.content}</div>
            </DialogContent>
          </Dialog>
        ) : null
      )}
    </OpenPanel.Provider>
  );
}

/** A button that opens one of the host's panels by name. */
export function PanelButton({
  name,
  label,
  icon,
  variant = "outline",
  size = "sm",
}: {
  name: string;
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
}) {
  const open = useContext(OpenPanel);
  return (
    <Button type="button" variant={variant} size={size} onClick={() => open(name)}>
      {icon}
      {label}
    </Button>
  );
}
