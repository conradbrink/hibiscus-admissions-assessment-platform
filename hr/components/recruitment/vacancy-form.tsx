"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { StaffActionState } from "@/components/staff/action-form";

export type VacancyValues = {
  campus_id: string;
  title: string;
  phase: string;
  subject: string;
  grade_range: string;
  employment_type: string;
  summary: string;
  description: string;
  requirements: string;
  salary_note: string;
  starts_on: string;
  closes_on: string;
};

/** The vacancy as applicants will read it. The phase decides which question bank it starts from. */
export function VacancyForm({
  action,
  initial,
  campuses,
  submitLabel,
  phaseLocked = false,
}: {
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  initial: VacancyValues;
  campuses: { id: string; name: string }[];
  submitLabel: string;
  phaseLocked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="surface space-y-5 p-6">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={initial.title} placeholder="Grade R teacher" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="campus_id">School</Label>
          <NativeSelect id="campus_id" name="campus_id" defaultValue={initial.campus_id} required>
            <option value="">Choose a school</option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase">Phase</Label>
          <NativeSelect id="phase" name="phase" defaultValue={initial.phase} disabled={phaseLocked} required>
            <option value="preschool">Pre-school</option>
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="general">Support staff (not teaching)</option>
          </NativeSelect>
          {phaseLocked ? <input type="hidden" name="phase" value={initial.phase} /> : null}
          <p className="text-xs text-muted-foreground">Decides which question bank the interview questions start from.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject (optional)</Label>
          <Input id="subject" name="subject" defaultValue={initial.subject} placeholder="Mathematics" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grade_range">Grades (optional)</Label>
          <Input id="grade_range" name="grade_range" defaultValue={initial.grade_range} placeholder="Grade 8 to 10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="employment_type">Type</Label>
          <NativeSelect id="employment_type" name="employment_type" defaultValue={initial.employment_type}>
            <option value="permanent">Permanent</option>
            <option value="fixed_term">Fixed term</option>
            <option value="part_time">Part time</option>
            <option value="temporary">Temporary</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salary_note">Pay (optional, shown to applicants)</Label>
          <Input id="salary_note" name="salary_note" defaultValue={initial.salary_note} placeholder="Discussed at interview" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="starts_on">Starts (optional)</Label>
          <Input id="starts_on" name="starts_on" type="date" defaultValue={initial.starts_on} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closes_on">Closing date</Label>
          <Input id="closes_on" name="closes_on" type="date" defaultValue={initial.closes_on} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="summary">One-line summary</Label>
          <Input id="summary" name="summary" defaultValue={initial.summary} maxLength={400} placeholder="A caring Grade R teacher for our Village campus, from January." />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="description">About the post</Label>
          <Textarea id="description" name="description" defaultValue={initial.description} rows={8} maxLength={8000} />
          <p className="text-xs text-muted-foreground">Plain text. Leave a blank line between paragraphs.</p>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="requirements">What you need (one per line)</Label>
          <Textarea id="requirements" name="requirements" defaultValue={initial.requirements} rows={5} placeholder={"A teaching qualification for the Foundation Phase\nRegistration with BTPC or SACE\nAt least two years' classroom experience"} />
        </div>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : state.ok ? (
        <p role="status" className="text-sm text-success">
          Saved.
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
