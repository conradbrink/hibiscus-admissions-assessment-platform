"use client";

import { cn } from "@/lib/utils";

/**
 * A yes/no question as two large buttons rather than a dropdown: one tap on a
 * phone, and the choice is visible at a glance. Real radio inputs underneath,
 * so it posts with the form and works with a keyboard.
 */
export function YesNo({
  name,
  legend,
  value,
  onChange,
  error,
  hint,
  yesLabel = "Yes",
  noLabel = "No",
}: {
  name: string;
  legend: React.ReactNode;
  value: string;
  onChange?: (v: "yes" | "no") => void;
  error?: string;
  hint?: string;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}>
      <legend className="text-[15px] font-medium">{legend}</legend>
      {hint ? (
        <p id={`${name}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div className="flex gap-2">
        {(["yes", "no"] as const).map((v) => (
          <label
            key={v}
            className={cn(
              "flex h-11 min-w-24 cursor-pointer items-center justify-center rounded-xl border px-5 text-[15px] font-medium transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
              value === v ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-foreground/40"
            )}
          >
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange?.(v)} className="sr-only" />
            {v === "yes" ? yesLabel : noLabel}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
