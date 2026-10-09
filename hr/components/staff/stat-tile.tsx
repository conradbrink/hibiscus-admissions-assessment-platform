import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One number a person acts on: the label, the figure, and a coloured chip
 * with an icon that says what kind of thing it is. A tile with a link is
 * the whole card; there is nothing else to press.
 */
export function StatTile({
  label,
  value,
  href,
  icon: Icon,
  tone = "default",
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  icon?: LucideIcon;
  tone?: "default" | "warning" | "destructive" | "success" | "info";
  hint?: string;
}) {
  const live = Number(value) > 0;
  const chip = {
    default: "bg-accent text-primary",
    info: "bg-info/12 text-info",
    success: "bg-success/12 text-success",
    warning: live ? "bg-warning/30 text-warning-foreground" : "bg-accent text-primary",
    destructive: live ? "bg-destructive/12 text-destructive" : "bg-accent text-primary",
  }[tone];
  const body = (
    <>
      <div className="flex items-center gap-2">
        {Icon ? (
          <span className={cn("flex size-8 items-center justify-center rounded-full", chip)}>
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      </div>
      <p className={cn("mt-3 text-3xl font-semibold tracking-tight tabular-nums", tone === "destructive" && live && "text-destructive")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const cls = cn("surface block px-4 py-4 transition-shadow", href && "hover:shadow-lift");
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
