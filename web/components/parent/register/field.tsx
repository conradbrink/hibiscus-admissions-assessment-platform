"use client";

import { Label } from "@/components/ui/label";

export type RegisterFormState = { error?: string; fields?: Record<string, string>; values?: Record<string, string> };

/**
 * A labelled field with either its error or its hint, and a note when the
 * value came from what the parent already told us.
 */
export function Field({
  id,
  name = id,
  label,
  error,
  hint,
  prefilled,
  children,
}: {
  id: string;
  name?: string;
  label: string;
  error?: string;
  hint?: string;
  prefilled?: boolean;
  children: React.ReactNode;
}) {
  void name;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {prefilled ? <span className="ml-2 text-xs font-normal text-muted-foreground">from your enquiry — still correct?</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function invalidProps(fields: Record<string, string>, name: string) {
  return fields[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {};
}
