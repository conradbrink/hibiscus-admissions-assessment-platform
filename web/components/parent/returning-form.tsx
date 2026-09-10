"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReenrolmentIntent } from "@/lib/supabase/types";
import {
  answerReturning,
  confirmFamilyDetails,
  type FamilyActionState,
} from "@/app/(parent)/family/returning/actions";

const CHOICES: Array<{ value: ReenrolmentIntent; label: string }> = [
  { value: "returning", label: "Yes, coming back" },
  { value: "not_returning", label: "No, leaving" },
  { value: "undecided", label: "Not sure yet" },
];

/**
 * One child's answer, or the "everything is still right" confirmation.
 *
 * The three choices are equal buttons rather than a dropdown with a default:
 * a parent should have to say which one they mean, and "not sure yet" should
 * be as easy to press as the other two. A pre-selected "yes" would quietly
 * turn silence into a place the school counts on.
 *
 * Only "no" asks for a reason, and only after it is chosen — the school wants
 * to know why a family is leaving, and nobody else should be made to explain
 * themselves before answering.
 */
export function ReturningForm({
  responseId,
  childName,
  grade,
  campus,
  intent,
  answeredAt,
  confirmOnly = false,
}: {
  responseId: string;
  childName: string;
  grade: string | null;
  campus: string | null;
  intent: ReenrolmentIntent | null;
  answeredAt: string | null;
  confirmOnly?: boolean;
}) {
  const [answerState, answerAction, answerPending] = useActionState<FamilyActionState, FormData>(
    answerReturning,
    {}
  );
  const [confirmState, confirmAction, confirmPending] = useActionState<FamilyActionState, FormData>(
    confirmFamilyDetails,
    {}
  );
  const [chosen, setChosen] = useState<ReenrolmentIntent | null>(intent);

  if (confirmOnly) {
    return (
      <form action={confirmAction} className="mt-4">
        <input type="hidden" name="responseId" value={responseId} />
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">
            What has changed? Leave this empty if everything is right.
          </span>
          <input
            name="changed"
            maxLength={500}
            placeholder="For example: my mobile number"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </label>
        <Button type="submit" variant="outline" className="mt-3" disabled={confirmPending}>
          {confirmPending ? "Saving…" : "Yes, this is right"}
        </Button>
        {confirmState.ok ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
            <Check className="size-4" aria-hidden /> Thank you — we have noted that.
          </p>
        ) : null}
        {confirmState.error ? <p className="mt-2 text-sm text-destructive">{confirmState.error}</p> : null}
      </form>
    );
  }

  const settled = answerState.ok || answeredAt !== null;

  return (
    <form action={answerAction} className="rounded-2xl border border-border/60 bg-card p-4">
      <input type="hidden" name="responseId" value={responseId} />
      <p className="font-medium">{childName}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {grade ?? "Class to be confirmed"}
        {campus ? ` · ${campus}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <label key={c.value} className="cursor-pointer">
            <input
              type="radio"
              name="intent"
              value={c.value}
              checked={chosen === c.value}
              onChange={() => setChosen(c.value)}
              className="peer sr-only"
              required
            />
            <span className="inline-flex h-10 items-center rounded-full border border-border px-4 text-sm peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
              {c.label}
            </span>
          </label>
        ))}
      </div>

      {chosen === "not_returning" ? (
        <label className="mt-3 block text-xs">
          <span className="mb-1 block text-muted-foreground">
            If you would tell us why, it helps us. You do not have to.
          </span>
          <input
            name="reason"
            maxLength={500}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </label>
      ) : null}

      <Button type="submit" className="mt-3" disabled={answerPending || !chosen}>
        {answerPending ? "Saving…" : settled ? "Change my answer" : "Send"}
      </Button>

      {settled && !answerState.error ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
          <Check className="size-4" aria-hidden /> Thank you — we have your answer.
        </p>
      ) : null}
      {answerState.error ? <p className="mt-2 text-sm text-destructive">{answerState.error}</p> : null}
    </form>
  );
}
