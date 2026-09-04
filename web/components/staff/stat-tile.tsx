import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "warning" | "destructive" | "success";
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "warning" && Number(value) > 0 && "text-warning-foreground",
          tone === "destructive" && Number(value) > 0 && "text-destructive",
          tone === "success" && "text-success"
        )}
      >
        {value}
      </p>
    </>
  );
  const cls = cn(
    "block rounded-xl border bg-card px-4 py-3",
    tone === "warning" && Number(value) > 0 ? "border-warning/60 bg-warning/10" : "border-border",
    tone === "destructive" && Number(value) > 0 ? "border-destructive/40 bg-destructive/5" : "",
    href && "hover:bg-muted"
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
