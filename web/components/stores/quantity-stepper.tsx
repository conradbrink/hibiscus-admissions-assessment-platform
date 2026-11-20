"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A number with a minus and a plus a thumb can hit. The field can be typed
 * into as well, for the forty refuse bags nobody wants to tap forty times.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max,
  label,
  className,
  size = "default",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  /** The accessible name: "Quantity of Portable Speaker". */
  label: string;
  className?: string;
  size?: "default" | "sm";
}) {
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  const btn = cn(
    "flex shrink-0 items-center justify-center rounded-xl border border-input bg-card text-foreground transition-colors hover:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-40",
    size === "sm" ? "size-10 md:size-9" : "size-12 md:size-10"
  );
  return (
    <div className={cn("flex items-center gap-1.5", className)} role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={`One fewer: ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Minus className="size-5 md:size-4" aria-hidden />
      </button>
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={label}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? min : clamp(n));
        }}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "w-16 rounded-xl border border-input bg-card text-center text-lg font-semibold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-base",
          size === "sm" ? "h-10 md:h-9" : "h-12 md:h-10"
        )}
      />
      <button type="button" className={btn} aria-label={`One more: ${label}`} disabled={max !== undefined && value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Plus className="size-5 md:size-4" aria-hidden />
      </button>
    </div>
  );
}
