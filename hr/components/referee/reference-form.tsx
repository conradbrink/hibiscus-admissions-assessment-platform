"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { YesNo } from "@/components/applicant/yes-no";
import { declineReferenceAction, submitReferenceAction } from "@/app/(referee)/reference/actions";
import { cn } from "@/lib/utils";

const RATINGS: ReadonlyArray<readonly [string, string]> = [
  ["teaching", "Teaching ability"],
  ["classroom_management", "Classroom management"],
  ["reliability", "Reliability and punctuality"],
  ["teamwork", "Working with colleagues"],
  ["parent_communication", "Communication with parents"],
  ["professionalism", "Professionalism"],
];

const SCALE = ["1", "2", "3", "4", "5"] as const;

/**
 * About four minutes: how they know the applicant, six ratings, the one
 * safeguarding question every school must ask, and a recommendation. Each
 * choice is a tap, not a dropdown; only "yes, there is a concern" asks for
 * writing.
 */
export function ReferenceForm({
  applicantName,
  statedJob,
  relationship,
}: {
  applicantName: string;
  statedJob: { employer: string; role_title: string; start_on: string; end_on: string | null } | null;
  relationship: string;
}) {
  const [state, action, pending] = useActionState(submitReferenceAction, {});
  const [concern, setConcern] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [declining, setDeclining] = useState(false);
  const err = state.fieldErrors ?? {};
  const first = applicantName.split(" ")[0];

  return (
    <div className="space-y-10">
      <form action={action} className="space-y-10" noValidate>
        <section className="space-y-5">
          <h2 className="text-xl font-semibold tracking-tight">How you know {first}</h2>
          <fieldset className="space-y-2">
            <legend className="text-[15px] font-medium">You were their</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["principal", "Principal or head of school"],
                ["line_manager", "Line manager or head of department"],
                ["colleague", "Colleague"],
                ["other", "Other"],
              ].map(([value, label]) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-card px-4 py-2.5 text-[15px] has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40">
                  <input type="radio" name="capacity" value={value} defaultChecked={relationship === value} className="size-4 accent-[var(--primary)]" />
                  {label}
                </label>
              ))}
            </div>
            {err.capacity ? <p className="text-sm text-destructive">{err.capacity}</p> : null}
          </fieldset>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="known_from">You worked together from</Label>
              <Input id="known_from" name="known_from" type="month" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="known_to">Until (leave empty if you still do)</Label>
              <Input id="known_to" name="known_to" type="month" />
            </div>
          </div>
          {statedJob ? (
            <>
              <YesNo
                name="role_and_dates_confirmed"
                legend={
                  <>
                    {first} told us they worked at {statedJob.employer} as <span className="font-semibold">{statedJob.role_title}</span>, from{" "}
                    {statedJob.start_on.slice(0, 7)} {statedJob.end_on ? `to ${statedJob.end_on.slice(0, 7)}` : "until now"}. Is that right?
                  </>
                }
                value={confirmed}
                onChange={setConfirmed}
                error={err.role_and_dates_confirmed}
              />
              {confirmed === "no" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="role_and_dates_note">What is different?</Label>
                  <Textarea id="role_and_dates_note" name="role_and_dates_note" rows={2} maxLength={1000} />
                </div>
              ) : null}
            </>
          ) : (
            <input type="hidden" name="role_and_dates_confirmed" value="yes" />
          )}
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Your view of their work</h2>
            <p className="mt-1 text-sm text-muted-foreground">1 is poor, 3 is good, 5 is outstanding.</p>
          </div>
          {RATINGS.map(([key, label]) => (
            <fieldset key={key} className="space-y-2">
              <legend className="text-[15px] font-medium">{label}</legend>
              <div className="flex gap-2">
                {SCALE.map((n) => (
                  <label
                    key={n}
                    className="flex size-11 cursor-pointer items-center justify-center rounded-xl border border-input bg-card text-[15px] font-semibold tabular-nums has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40"
                  >
                    <input type="radio" name={`rating_${key}`} value={n} className="sr-only" aria-label={`${label}: ${n} of 5`} />
                    {n}
                  </label>
                ))}
              </div>
              {err[`ratings.${key}`] ? <p className="text-sm text-destructive">Please choose a number.</p> : null}
            </fieldset>
          ))}
        </section>

        <section className="space-y-5">
          <h2 className="text-xl font-semibold tracking-tight">Safeguarding</h2>
          <YesNo
            name="concern"
            legend={`Was ${first} ever subject to disciplinary action, or are you aware of any concern about their suitability to work with children?`}
            hint="We ask every referee this. Your answer goes only to our senior Human Resources staff."
            value={concern}
            onChange={setConcern}
            error={err.concern}
          />
          {concern === "yes" ? (
            <div className="space-y-1.5">
              <Label htmlFor="concern_detail">Please tell us what happened</Label>
              <Textarea id="concern_detail" name="concern_detail" rows={4} maxLength={3000} aria-invalid={!!err.concern_detail} />
              {err.concern_detail ? <p className="text-sm text-destructive">{err.concern_detail}</p> : null}
            </div>
          ) : null}
        </section>

        <section className="space-y-5">
          <h2 className="text-xl font-semibold tracking-tight">Your recommendation</h2>
          <div className="space-y-1.5">
            <Label htmlFor="reason_for_leaving">Why did they leave, if you know? (optional)</Label>
            <Input id="reason_for_leaving" name="reason_for_leaving" maxLength={1000} />
          </div>
          <Choice
            name="would_reemploy"
            legend="Would you employ them again?"
            options={[
              ["yes", "Yes"],
              ["no", "No"],
              ["not_applicable", "Not my decision"],
            ]}
            error={err.would_reemploy}
          />
          <Choice
            name="recommendation"
            legend={`Do you recommend ${first} for this post?`}
            options={[
              ["yes", "Yes"],
              ["with_reservations", "Yes, with reservations"],
              ["no", "No"],
            ]}
            error={err.recommendation}
          />
          <div className="space-y-1.5">
            <Label htmlFor="comments">Anything else we should know? (optional)</Label>
            <Textarea id="comments" name="comments" rows={3} maxLength={3000} />
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px]">I confirm that this reference is my honest opinion and that I am the person this request was sent to.</p>
          <div className="space-y-1.5 sm:w-2/3">
            <Label htmlFor="referee_name_confirmed">Type your full name</Label>
            <Input id="referee_name_confirmed" name="referee_name_confirmed" autoComplete="name" aria-invalid={!!err.referee_name_confirmed} />
            {err.referee_name_confirmed ? <p className="text-sm text-destructive">Please type your name.</p> : null}
          </div>
        </section>

        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
        <div className="sm:w-72">
          <Button type="submit" size="parent" disabled={pending}>
            {pending ? "Sending…" : "Send my reference"}
          </Button>
        </div>
      </form>

      <div className="border-t border-border pt-6">
        {declining ? (
          <DeclineForm onCancel={() => setDeclining(false)} />
        ) : (
          <button type="button" onClick={() => setDeclining(true)} className="rounded-md text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
            I cannot give a reference for {first}
          </button>
        )}
      </div>
    </div>
  );
}

function Choice({ name, legend, options, error }: { name: string; legend: string; options: ReadonlyArray<readonly [string, string]>; error?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[15px] font-medium">{legend}</legend>
      <div className={cn("grid gap-2", options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map(([value, label]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-card px-4 py-2.5 text-[15px] has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40">
            <input type="radio" name={name} value={value} className="size-4 accent-[var(--primary)]" />
            {label}
          </label>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </fieldset>
  );
}

function DeclineForm({ onCancel }: { onCancel: () => void }) {
  const [state, action, pending] = useActionState(declineReferenceAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="reason">Why not? (optional, for example: I do not know them well enough)</Label>
        <Input id="reason" name="reason" maxLength={1000} />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {pending ? "Sending…" : "Tell the school"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
