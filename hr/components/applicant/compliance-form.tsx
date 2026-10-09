"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { YesNo } from "@/components/applicant/yes-no";
import { saveComplianceAction } from "@/app/(applicant)/apply/actions";

export type ComplianceValues = {
  registration_body: string;
  registration_number: string;
  registration_expires_on: string;
  needs_permit: string;
  permit_type: string;
  permit_number: string;
  permit_expires_on: string;
  police_clearance: string;
  police_clearance_issued_on: string;
  child_protection_clear: string;
  criminal_record: string;
  criminal_record_detail: string;
  dismissed_before: string;
  dismissed_detail: string;
  safeguarding_concern: string;
  safeguarding_detail: string;
  declaration_name: string;
};

/**
 * Permission to teach, and the safeguarding declarations. The questions that
 * depend on an earlier answer appear only when they apply, so a citizen with
 * a current registration answers six questions, not seventeen. Every "yes"
 * that needs detail asks for it in the same place.
 */
export function ComplianceForm({ initial, country }: { initial: ComplianceValues; country: "BW" | "ZA" }) {
  const [state, action, pending] = useActionState(saveComplianceAction, {});
  const [v, setV] = useState(initial);
  const set = (k: keyof ComplianceValues) => (value: string) => setV((s) => ({ ...s, [k]: value }));
  const err = state.fieldErrors ?? {};
  const body = country === "ZA" ? "SACE" : "BTPC";
  const bodyName = country === "ZA" ? "the South African Council for Educators (SACE)" : "the Botswana Teaching Professionals Council (BTPC)";

  const field = (k: keyof ComplianceValues, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} name={k} value={v[k]} onChange={(e) => set(k)(e.target.value)} aria-invalid={!!err[k]} aria-describedby={err[k] ? `${k}-error` : hint ? `${k}-hint` : undefined} {...props} />
      {hint ? (
        <p id={`${k}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {err[k] ? (
        <p id={`${k}-error`} className="text-sm text-destructive">
          {err[k]}
        </p>
      ) : null}
    </div>
  );

  const detail = (k: keyof ComplianceValues, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Textarea id={k} name={k} value={v[k]} onChange={(e) => set(k)(e.target.value)} rows={3} maxLength={2000} aria-invalid={!!err[k]} aria-describedby={err[k] ? `${k}-error` : undefined} />
      {err[k] ? (
        <p id={`${k}-error`} className="text-sm text-destructive">
          {err[k]}
        </p>
      ) : null}
    </div>
  );

  return (
    <form action={action} className="space-y-10" noValidate>
      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Teacher registration</h2>
        <fieldset className="space-y-2">
          <legend className="text-[15px] font-medium">Are you registered with {bodyName}?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              [body, `Yes, with ${body}`],
              ["other", "Yes, with another council"],
              ["none", "Not yet"],
            ].map(([value, label]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-card px-4 py-2.5 text-[15px] has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40">
                <input type="radio" name="registration_body" value={value} checked={v.registration_body === value} onChange={() => set("registration_body")(value)} className="size-4 accent-[var(--primary)]" />
                {label}
              </label>
            ))}
          </div>
          {err.registration_body ? <p className="text-sm text-destructive">{err.registration_body}</p> : null}
        </fieldset>
        {v.registration_body && v.registration_body !== "none" ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {field("registration_number", "Registration number")}
            {field("registration_expires_on", "Valid until (if it has a date)", { type: "date" })}
          </div>
        ) : v.registration_body === "none" ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm">You can still apply. We will ask for proof of registration before you start work.</p>
        ) : null}
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Right to work</h2>
        <YesNo name="needs_permit" legend={`Do you need a work or residence permit to work in ${country === "ZA" ? "South Africa" : "Botswana"}?`} value={v.needs_permit} onChange={set("needs_permit")} error={err.needs_permit} />
        {v.needs_permit === "yes" ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {field("permit_type", "Type of permit", { placeholder: "Work permit, residence permit…" })}
            {field("permit_number", "Permit number (if you have one)")}
            {field("permit_expires_on", "Valid until", { type: "date" }, "Leave empty if you have applied but have not received it.")}
          </div>
        ) : null}
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Police clearance</h2>
        <fieldset className="space-y-2">
          <legend className="text-[15px] font-medium">Do you have a police clearance certificate?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ["have", "Yes"],
              ["applied", "I have applied"],
              ["none", "Not yet"],
            ].map(([value, label]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-card px-4 py-2.5 text-[15px] has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40">
                <input type="radio" name="police_clearance" value={value} checked={v.police_clearance === value} onChange={() => set("police_clearance")(value)} className="size-4 accent-[var(--primary)]" />
                {label}
              </label>
            ))}
          </div>
          {err.police_clearance ? <p className="text-sm text-destructive">{err.police_clearance}</p> : null}
        </fieldset>
        {v.police_clearance === "have" ? <div className="sm:w-1/2">{field("police_clearance_issued_on", "Date on the certificate", { type: "date" })}</div> : null}
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Safeguarding declaration</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            We ask every applicant these questions because we work with children. Answering yes does not end your application: a senior member of our team reads it in confidence.
          </p>
        </div>
        <YesNo
          name="child_protection_clear"
          legend={
            country === "ZA"
              ? "I am not listed on the National Register for Sex Offenders or Part B of the Child Protection Register."
              : "I am not listed on any register of people barred from working with children."
          }
          yesLabel="That is true"
          noLabel="That is not true"
          value={v.child_protection_clear}
          onChange={set("child_protection_clear")}
          error={err.child_protection_clear}
        />
        <YesNo name="criminal_record" legend="Have you ever been convicted of a criminal offence?" value={v.criminal_record} onChange={set("criminal_record")} error={err.criminal_record} />
        {v.criminal_record === "yes" ? detail("criminal_record_detail", "Please tell us what happened, and when") : null}
        <YesNo name="dismissed_before" legend="Have you ever been dismissed from a job, or left during a disciplinary process?" value={v.dismissed_before} onChange={set("dismissed_before")} error={err.dismissed_before} />
        {v.dismissed_before === "yes" ? detail("dismissed_detail", "Please tell us what happened, and when") : null}
        <YesNo
          name="safeguarding_concern"
          legend="Has anyone ever raised a concern about your conduct with children?"
          value={v.safeguarding_concern}
          onChange={set("safeguarding_concern")}
          error={err.safeguarding_concern}
        />
        {v.safeguarding_concern === "yes" ? detail("safeguarding_detail", "Please tell us what happened, and what the outcome was") : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <p className="text-[15px]">I confirm that what I have written in this application is true. I understand that a false answer may end my application or my employment.</p>
        <div className="sm:w-2/3">{field("declaration_name", "Type your full name to sign", { autoComplete: "name" })}</div>
      </section>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="border-t border-border pt-6">
        <div className="sm:w-72">
        <Button type="submit" size="parent" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
        </div>
      </div>
    </form>
  );
}
