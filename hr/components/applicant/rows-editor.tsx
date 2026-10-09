"use client";

import { useActionState, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FormState } from "@/app/(applicant)/apply/actions";

/**
 * A list the applicant builds: qualifications, jobs, referees. Each row is a
 * small fieldset; the whole list is posted as JSON in one field, and the
 * server validates it with the same schema it stores by. Errors come back
 * keyed `rowIndex.field` and are shown under the field they belong to.
 */

export type FieldDef =
  | { name: string; label: string; type: "text" | "email" | "tel" | "date" | "number"; required?: boolean; hint?: string; half?: boolean; autoComplete?: string; placeholder?: string }
  | { name: string; label: string; type: "select"; options: ReadonlyArray<readonly [string, string]>; required?: boolean; hint?: string; half?: boolean }
  | { name: string; label: string; type: "checkbox"; hint?: string }
  | { name: string; label: string; type: "textarea"; hint?: string; maxLength?: number };

export type Row = Record<string, string | boolean | number | null>;

export function RowsEditor({
  action,
  fields,
  initial,
  blank,
  itemLabel,
  addLabel,
  min = 0,
  max = 15,
  submitLabel = "Save and continue",
  intro,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: FieldDef[];
  initial: Row[];
  blank: Row;
  itemLabel: string;
  addLabel: string;
  min?: number;
  max?: number;
  submitLabel?: string;
  intro?: React.ReactNode;
}) {
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : min > 0 ? Array.from({ length: min }, () => ({ ...blank })) : []);
  const [state, formAction, pending] = useActionState(action, {});
  const id = useId();
  const errors = state.fieldErrors ?? {};

  const update = (i: number, name: string, value: string | boolean) => setRows((r) => r.map((row, k) => (k === i ? { ...row, [name]: value } : row)));

  // What the server receives: numbers as numbers, empty strings as absent.
  const payload = rows.map((row) =>
    Object.fromEntries(
      fields.map((f) => {
        const v = row[f.name];
        if (f.type === "checkbox") return [f.name, !!v];
        if (f.type === "number") return [f.name, v === "" || v === null || v === undefined ? null : Number(v)];
        return [f.name, typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)];
      })
    )
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {intro}
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-[15px] text-muted-foreground">Nothing added yet.</p>
      ) : null}
      {rows.map((row, i) => (
        <fieldset key={i} className="rounded-2xl border border-border bg-card p-5">
          <legend className="sr-only">
            {itemLabel} {i + 1}
          </legend>
          <div className="mb-4 flex items-center justify-between">
            <p className="font-semibold">
              {itemLabel} {i + 1}
            </p>
            {rows.length > min ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((_, k) => k !== i))} aria-label={`Remove ${itemLabel.toLowerCase()} ${i + 1}`}>
                <Trash2 aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => {
              const fid = `${id}-${i}-${f.name}`;
              const err = errors[`${i}.${f.name}`];
              const described = [f.hint ? `${fid}-hint` : null, err ? `${fid}-error` : null].filter(Boolean).join(" ") || undefined;
              const value = row[f.name];
              const wide = f.type === "checkbox" || f.type === "textarea" || !("half" in f && f.half);
              return (
                <div key={f.name} className={cn("space-y-1.5", wide && "sm:col-span-2")}>
                  {f.type === "checkbox" ? (
                    <label className="flex items-start gap-3 text-[15px]">
                      <input type="checkbox" id={fid} checked={!!value} onChange={(e) => update(i, f.name, e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" aria-describedby={described} />
                      <span>{f.label}</span>
                    </label>
                  ) : (
                    <>
                      <Label htmlFor={fid}>{f.label}</Label>
                      {f.type === "select" ? (
                        <select
                          id={fid}
                          value={String(value ?? "")}
                          onChange={(e) => update(i, f.name, e.target.value)}
                          aria-invalid={!!err}
                          aria-describedby={described}
                          className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm"
                        >
                          <option value="">Choose…</option>
                          {f.options.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      ) : f.type === "textarea" ? (
                        <textarea
                          id={fid}
                          value={String(value ?? "")}
                          maxLength={f.maxLength}
                          onChange={(e) => update(i, f.name, e.target.value)}
                          aria-invalid={!!err}
                          aria-describedby={described}
                          rows={2}
                          className="w-full rounded-xl border border-input bg-card px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                        />
                      ) : (
                        <Input
                          id={fid}
                          type={f.type}
                          value={String(value ?? "")}
                          autoComplete={"autoComplete" in f ? f.autoComplete : undefined}
                          placeholder={"placeholder" in f ? f.placeholder : undefined}
                          inputMode={f.type === "number" ? "numeric" : undefined}
                          onChange={(e) => update(i, f.name, e.target.value)}
                          aria-invalid={!!err}
                          aria-describedby={described}
                        />
                      )}
                    </>
                  )}
                  {f.hint ? (
                    <p id={`${fid}-hint`} className="text-sm text-muted-foreground">
                      {f.hint}
                    </p>
                  ) : null}
                  {err ? (
                    <p id={`${fid}-error`} className="text-sm text-destructive">
                      {err}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      {rows.length < max ? (
        <Button type="button" variant="outline" size="lg" onClick={() => setRows((r) => [...r, { ...blank }])}>
          <Plus aria-hidden /> {addLabel}
        </Button>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
          {errors._ ? ` ${errors._}` : ""}
        </p>
      ) : null}
      <div className="border-t border-border pt-6">
        <div className="sm:w-72">
        <Button type="submit" size="parent" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        </div>
      </div>
    </form>
  );
}
