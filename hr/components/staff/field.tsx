import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A label above its input, with an optional line of help under it. */
export function Field({ label, htmlFor, hint, className, children }: { label: string; htmlFor: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A small read-only label and value, for detail panels. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || <span className="text-muted-foreground">Not recorded</span>}</dd>
    </div>
  );
}

/** A coloured status pill. */
export function Pill({ tone = "muted", children }: { tone?: "muted" | "success" | "warning" | "destructive" | "info" | "primary"; children: React.ReactNode }) {
  const cls = {
    muted: "bg-muted text-muted-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    destructive: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
    primary: "bg-accent text-accent-foreground",
  }[tone];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", cls)}>{children}</span>;
}
