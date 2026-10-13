"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A button that opens a panel of detail: the offer editor, the letter as the
 * parent reads it. The applicant page shows the summary; the fields are one
 * click away rather than permanently on screen.
 *
 * The contents are rendered on the server and passed in, so the forms inside
 * are the same server actions as anywhere else. The panel stays open after a
 * save, showing the updated values, until it is closed.
 */
export function ModalPanel({
  label,
  title,
  description,
  variant = "outline",
  size = "sm",
  wide = false,
  icon,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
  /** The letter preview needs the width a letter has. */
  wide?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant={variant} size={size} />}>
        {icon}
        {label}
      </DialogTrigger>
      <DialogContent className={cn("max-h-[85dvh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="text-sm">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
