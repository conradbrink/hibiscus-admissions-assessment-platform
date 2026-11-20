import { Package } from "lucide-react";
import { itemPhotoUrl } from "@/lib/stores/photo";
import { cn } from "@/lib/utils";

/**
 * The item's photo beside its name, or a quiet package glyph when it has
 * none, so rows line up either way. Served by the console's own route, which
 * checks the session; lazy, so a long list does not fetch fifty at once.
 */
export function ItemThumb({ itemId, sha256, name, className }: { itemId: string; sha256: string | null | undefined; name: string; className?: string }) {
  const url = itemPhotoUrl(itemId, sha256);
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, session-checked route; the optimiser would fetch it without the session
        <img src={url} alt={`Photo of ${name}`} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <Package className="size-1/2 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}
