import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The pieces the two event forms share: a labelled box with its error under
 * it, a pair of name boxes for one ticket, and the box only a script fills
 * in. Labels sit above the box, never inside it, and an error is tied to its
 * box so a screen reader reads them together.
 */

export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function invalidProps(errors: Record<string, string>, name: string) {
  return errors[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {};
}

/** First and last name for one ticket: `holderFirst<i>` and `holderLast<i>`. */
export function HolderNames({
  index,
  legend,
  errors,
  values,
}: {
  index: number;
  legend: string;
  errors: Record<string, string>;
  values: Record<string, string>;
}) {
  const first = `holderFirst${index}`;
  const last = `holderLast${index}`;
  return (
    <fieldset className="grid gap-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold text-foreground sm:col-span-2">{legend}</legend>
      <Field id={first} label="First name" error={errors[first]}>
        <Input id={first} name={first} autoComplete="off" defaultValue={values[first]} required maxLength={80} {...invalidProps(errors, first)} />
      </Field>
      <Field id={last} label="Last name" error={errors[last]}>
        <Input id={last} name={last} autoComplete="off" defaultValue={values[last]} required maxLength={80} {...invalidProps(errors, last)} />
      </Field>
    </fieldset>
  );
}

/** Off screen and out of the tab order: a person never fills it in. */
export function Honeypot() {
  return (
    <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label htmlFor="website">Website</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}
