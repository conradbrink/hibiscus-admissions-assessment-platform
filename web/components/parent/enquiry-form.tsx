"use client";

import { useActionState, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FunnelT0Field } from "@/components/parent/funnel-beacon";
import type { EntryRoute } from "@/lib/supabase/types";

export type EnquiryFormState = {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
};

export type EnquiryFormProps = {
  route: EntryRoute;
  campuses: Array<{ id: string; name: string; descriptor: string | null }>;
  action: (state: EnquiryFormState, formData: FormData) => Promise<EnquiryFormState>;
};

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
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

/**
 * The eight fields. Everything else the old form asked for is asked later,
 * or never. Field order follows how a parent thinks: who am I, how do you
 * reach me, who is my child, where.
 */
export function EnquiryForm({ route, campuses, action }: EnquiryFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const started = useRef(false);
  const f = state.fields ?? {};
  const v = state.values ?? {};

  const onFirstFocus = () => {
    if (started.current) return;
    started.current = true;
    try {
      if (!sessionStorage.getItem("hbs_funnel_t0")) {
        sessionStorage.setItem("hbs_funnel_t0", String(Date.now()));
      }
      const body = JSON.stringify({ step: "enquiry.started", elapsedMs: 0 });
      navigator.sendBeacon?.("/api/funnel", new Blob([body], { type: "application/json" }));
    } catch {
      // measurement only
    }
  };

  const invalid = (name: string) => (f[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});

  return (
    <form action={formAction} onFocusCapture={onFirstFocus} className="space-y-6" noValidate>
      <FunnelT0Field />
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">About you</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field id="parentFirstName" label="First name" error={f.parentFirstName}>
            <Input id="parentFirstName" name="parentFirstName" autoComplete="given-name" defaultValue={v.parentFirstName} required {...invalid("parentFirstName")} />
          </Field>
          <Field id="parentLastName" label="Surname" error={f.parentLastName}>
            <Input id="parentLastName" name="parentLastName" autoComplete="family-name" defaultValue={v.parentLastName} required {...invalid("parentLastName")} />
          </Field>
        </div>
        <Field id="mobile" label="Mobile number" error={f.mobile} hint="We only call if you ask us to.">
          <Input id="mobile" name="mobile" type="tel" inputMode="tel" autoComplete="tel" placeholder="71 234 567" defaultValue={v.mobile} required {...invalid("mobile")} />
        </Field>
        <Field id="email" label="Email address" error={f.email} hint="Everything about your application arrives here.">
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={v.email} required {...invalid("email")} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="whatsappOptIn" value="1" defaultChecked={v.whatsappOptIn === "1"} className="mt-0.5 size-5 shrink-0 accent-primary" />
          <span>
            Also send me updates about this application on WhatsApp, to the mobile number above.
            <span className="block text-xs text-muted-foreground">Optional. Reply STOP at any time. Email remains the full record.</span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">About your child</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field id="childFirstName" label="First name" error={f.childFirstName}>
            <Input id="childFirstName" name="childFirstName" autoComplete="off" defaultValue={v.childFirstName} required {...invalid("childFirstName")} />
          </Field>
          <Field id="childLastName" label="Surname" error={f.childLastName}>
            <Input id="childLastName" name="childLastName" autoComplete="off" defaultValue={v.childLastName} required {...invalid("childLastName")} />
          </Field>
        </div>
        <Field id="childDateOfBirth" label="Date of birth" error={f.childDateOfBirth} hint="We use this to suggest the right grade.">
          <Input id="childDateOfBirth" name="childDateOfBirth" type="date" defaultValue={v.childDateOfBirth} required {...invalid("childDateOfBirth")} />
        </Field>
        <Field id="campusId" label="Preferred campus" error={f.campusId}>
          <NativeSelect id="campusId" name="campusId" defaultValue={v.campusId ?? ""} required {...invalid("campusId")}>
            <option value="" disabled>
              Choose a campus
            </option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.descriptor ? ` — ${c.descriptor}` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </fieldset>

      {route === "callback" ? (
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-foreground">About the call</legend>
          <Field id="preferredTime" label="Best time to call" error={f.preferredTime}>
            <Input id="preferredTime" name="preferredTime" placeholder="Weekday mornings" defaultValue={v.preferredTime} />
          </Field>
          <Field id="message" label="Anything you would like us to know" error={f.message}>
            <Textarea id="message" name="message" rows={3} defaultValue={v.message} />
          </Field>
        </fieldset>
      ) : null}

      {state.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="parent" disabled={pending}>
        {pending ? "One moment…" : "Continue"}
        {!pending ? <ArrowRight data-icon="inline-end" /> : null}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        By continuing you agree to Hibiscus Schools using these details to process an enquiry.
      </p>
    </form>
  );
}
