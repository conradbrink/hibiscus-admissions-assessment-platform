import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { flagMeta } from "@/lib/scoring/flags";
import { cn } from "@/lib/utils";

/**
 * The score as a number out of 100, and how much of the 100 could be scored
 * so far. "62 / 85" reads as provisional at a glance; the ring would not.
 */
export function ScoreBadge({ total, available, size = "md" }: { total: number | null; available: number | null; size?: "md" | "lg" }) {
  if (total === null || !available) {
    return <span className={cn("font-semibold text-muted-foreground tabular-nums", size === "lg" ? "text-3xl" : "text-sm")}>Not scored</span>;
  }
  const pct = total / available;
  const tone = pct >= 0.75 ? "text-success" : pct >= 0.5 ? "text-foreground" : "text-destructive";
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className={cn("font-semibold", tone, size === "lg" ? "text-4xl tracking-tight" : "text-base")}>{Math.round(total)}</span>
      <span className={cn("text-muted-foreground", size === "lg" ? "text-base" : "text-xs")}>
        / {available}
        {available < 100 ? " so far" : ""}
      </span>
    </span>
  );
}

export function FlagChips({ codes, limit }: { codes: readonly string[]; limit?: number }) {
  const shown = limit ? codes.slice(0, limit) : codes;
  if (!codes.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Flags">
      {shown.map((code) => {
        const meta = flagMeta(code);
        const Icon = meta.severity === "critical" ? ShieldAlert : meta.severity === "warning" ? AlertTriangle : Info;
        return (
          <li
            key={code}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
              meta.severity === "critical" && "bg-destructive/12 text-destructive",
              meta.severity === "warning" && "bg-warning/30 text-warning-foreground",
              meta.severity === "info" && "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="size-3" aria-hidden />
            {meta.short}
          </li>
        );
      })}
      {limit && codes.length > limit ? <li className="px-1 text-[11.5px] text-muted-foreground">+{codes.length - limit}</li> : null}
    </ul>
  );
}

const STAGE_STYLE: Record<string, string> = {
  review: "bg-info/12 text-info",
  shortlisted: "bg-success/12 text-success",
  unsuccessful: "bg-muted text-muted-foreground",
};

export function StageBadge({ stage, status }: { stage: string | null; status: string }) {
  const label = status === "hired" ? "Hired" : status === "withdrawn" ? "Withdrawn" : status === "draft" ? "Not sent" : stage === "review" ? "Review" : stage === "shortlisted" ? "Shortlisted" : stage === "unsuccessful" ? "Unsuccessful" : status;
  const style = status === "hired" ? "bg-primary text-primary-foreground" : status !== "submitted" ? "bg-muted text-muted-foreground" : STAGE_STYLE[stage ?? ""] ?? "bg-muted";
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", style)}>{label}</span>;
}
