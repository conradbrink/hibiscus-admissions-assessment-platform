"use client";

import { useActionState, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FunnelT0Field } from "@/components/parent/funnel-beacon";
import type { ActionState } from "@/app/(parent)/next/actions";

export type GradeConfirmProps = {
  childFirstName: string;
  campuses: Array<{ id: string; name: string }>;
  grades: Array<{ id: string; name: string; requires_assessment: boolean }>;
  offered: Record<string, string[]>;
  intakes: Array<{ id: string; label: string }>;
  initial: { campusId: string; gradeId: string; intakeId: string };
  recommended: { gradeId: string; gradeName: string; ageOnCutoff: number } | null;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
};

/**
 * "Based on your child's age, we recommend Stage 4." The recommendation is
 * the default; changing it is one tap away, and only within what the chosen
 * campus offers. If the recommended grade is not offered where the parent
 * chose, the campuses that do offer it are shown instead of an error.
 */
export function GradeConfirmForm(props: GradeConfirmProps) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [campusId, setCampusId] = useState(props.initial.campusId);
  const [gradeId, setGradeId] = useState(props.initial.gradeId);

  const gradesHere = useMemo(() => {
    const ids = new Set(props.offered[campusId] ?? []);
    return props.grades.filter((g) => ids.has(g.id));
  }, [campusId, props.grades, props.offered]);

  const recommendedHere = props.recommended
    ? (props.offered[campusId] ?? []).includes(props.recommended.gradeId)
    : false;
  const campusesOfferingRecommended = props.recommended
    ? props.campuses.filter((c) => (props.offered[c.id] ?? []).includes(props.recommended!.gradeId))
    : [];
  const selectedGrade = props.grades.find((g) => g.id === gradeId);
  const gradeValid = gradesHere.some((g) => g.id === gradeId);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FunnelT0Field />

      {props.recommended ? (
        <div className="rounded-2xl bg-accent px-5 py-4 text-accent-foreground">
          <p className="text-sm font-semibold">Based on {props.childFirstName}&rsquo;s age, we recommend</p>
          <p className="mt-1 text-2xl font-bold">{props.recommended.gradeName}</p>
          <p className="mt-1 text-sm">
            {props.childFirstName} will be {props.recommended.ageOnCutoff} on the age cut-off date for this
            intake.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-muted px-5 py-4">
          <p className="text-sm font-semibold">We could not match an age group automatically.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please choose the grade {props.childFirstName} is applying for. Our admissions team will confirm it.
          </p>
        </div>
      )}

      {props.recommended && !recommendedHere ? (
        <div className="rounded-2xl border border-warning/60 bg-warning/15 px-5 py-4 text-sm">
          <p className="font-semibold">
            The campus you chose does not offer {props.recommended.gradeName}.
          </p>
          <p className="mt-1 text-muted-foreground">
            {campusesOfferingRecommended.length > 0
              ? `It is offered at ${campusesOfferingRecommended.map((c) => c.name).join(", ")}. Change the campus below, or choose a different grade.`
              : "Choose a different grade below, or request a call and we will help."}
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="campusId">Campus</Label>
        <NativeSelect
          id="campusId"
          name="campusId"
          value={campusId}
          onChange={(e) => {
            const next = e.target.value;
            setCampusId(next);
            const ids = props.offered[next] ?? [];
            if (props.recommended && ids.includes(props.recommended.gradeId)) {
              setGradeId(props.recommended.gradeId);
            } else if (!ids.includes(gradeId)) {
              setGradeId(ids[0] ?? "");
            }
          }}
        >
          {props.campuses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gradeId">Grade</Label>
        <NativeSelect id="gradeId" name="gradeId" value={gradeValid ? gradeId : ""} onChange={(e) => setGradeId(e.target.value)}>
          <option value="" disabled>
            Choose a grade
          </option>
          {gradesHere.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {props.recommended?.gradeId === g.id ? " (recommended)" : ""}
            </option>
          ))}
        </NativeSelect>
        {selectedGrade && !selectedGrade.requires_assessment ? (
          <p className="text-xs text-muted-foreground">
            Children joining {selectedGrade.name} do not sit an assessment.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="intakeId">Starting</Label>
        <NativeSelect id="intakeId" name="intakeId" defaultValue={props.initial.intakeId}>
          {props.intakes.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="parent" disabled={pending || !gradeValid}>
        {pending ? "One moment…" : "Confirm and continue"}
        {!pending ? <ArrowRight data-icon="inline-end" /> : null}
      </Button>
    </form>
  );
}
