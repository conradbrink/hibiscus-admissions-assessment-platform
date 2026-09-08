"use client";

import { useState, useTransition } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecordVoiceState } from "@/app/staff/(console)/admin/assessment-templates/actions";

/**
 * Pre-records a story chapter's lines so the first child to sit it hears
 * no gaps. Keeps calling the action until every line is recorded.
 */
export function RecordVoiceButton({ templateId, action }: { templateId: string; action: (templateId: string) => Promise<RecordVoiceState> }) {
  const [state, setState] = useState<RecordVoiceState | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      let next = await action(templateId);
      setState(next);
      let rounds = 0;
      while (!next.done && !next.error && rounds < 40) {
        rounds += 1;
        next = await action(templateId);
        setState(next);
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={pending}>
        <Mic data-icon="inline-start" /> {pending ? "Recording…" : "Record the voice"}
      </Button>
      {state?.unavailable ? <span className="text-xs text-muted-foreground">No voice service is configured; the browser voice reads the story.</span> : null}
      {state && !state.unavailable ? (
        <span className="text-xs text-muted-foreground">
          {state.recorded} of {state.total} lines recorded{state.done ? "." : "…"}
        </span>
      ) : null}
      {state?.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </div>
  );
}
