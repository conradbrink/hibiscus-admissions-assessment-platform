"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeChecklistItem } from "@/app/(parent)/family/checklist/actions";
import type { FamilyActionState } from "@/app/(parent)/family/returning/actions";

/**
 * One errand on a family's checklist.
 *
 * Deliberately not a wizard. These happen in whatever order the family gets
 * to them — a uniform size on Tuesday, the class group on Saturday — so each
 * one stands alone and finishing them out of order costs nothing.
 *
 * A step that is already done stays visible rather than disappearing. A list
 * that shortens as you work it hides what you have achieved, and a parent who
 * wants to change an answer needs to be able to find it.
 */
export function ChecklistItem({
  itemId,
  label,
  description,
  kind,
  options,
  status,
  dueOn,
  linkUrl,
}: {
  itemId: string;
  label: string;
  description: string | null;
  kind: "acknowledge" | "choice" | "upload" | "link" | "action";
  options: string[];
  status: "pending" | "in_progress" | "done" | "not_applicable" | "blocked";
  dueOn: string | null;
  linkUrl: string | null;
}) {
  const [state, action, pending] = useActionState<FamilyActionState, FormData>(completeChecklistItem, {});
  const [choice, setChoice] = useState("");
  const done = state.ok || status === "done" || status === "not_applicable";

  return (
    <li className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
            done ? "border-success bg-success text-success-foreground" : "border-border"
          }`}
        >
          {done ? <Check className="size-3.5" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{label}</p>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          {dueOn && !done ? <p className="mt-1 text-xs text-muted-foreground">By {dueOn}</p> : null}

          {!done ? (
            <form action={action} className="mt-3">
              <input type="hidden" name="itemId" value={itemId} />
              {kind === "choice" && options.length ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {options.map((o) => (
                    <label key={o} className="cursor-pointer">
                      <input
                        type="radio"
                        name="choice"
                        value={o}
                        checked={choice === o}
                        onChange={() => setChoice(o)}
                        className="peer sr-only"
                        required
                      />
                      <span className="inline-flex h-9 items-center rounded-full border border-border px-3 text-sm peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
                        {o}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}

              {kind === "link" && linkUrl ? (
                <p className="mb-2 text-sm">
                  <a href={linkUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                    Open the group
                  </a>{" "}
                  <span className="text-muted-foreground">
                    — then tell us you have joined. WhatsApp cannot tell us for you.
                  </span>
                </p>
              ) : null}

              <Button
                type="submit"
                size="sm"
                variant={kind === "acknowledge" ? "default" : "outline"}
                disabled={pending || (kind === "choice" && options.length > 0 && !choice)}
              >
                {pending
                  ? "Saving…"
                  : kind === "link"
                    ? "I have joined"
                    : kind === "acknowledge"
                      ? "Done"
                      : "Save"}
              </Button>
              {state.error ? <p className="mt-2 text-sm text-destructive">{state.error}</p> : null}
            </form>
          ) : null}
        </div>
      </div>
    </li>
  );
}
