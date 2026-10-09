"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveAnswerAction } from "@/app/(applicant)/apply/actions";

/**
 * One written answer, saved as the applicant types.
 *
 * It also records how the answer was written, for the AI-writing check the
 * applicant was told about: how long they spent typing, how many keys they
 * pressed, how many characters arrived by pasting, and how often the tab
 * lost focus. Nothing about the content of what was pasted is kept, and none
 * of it changes the score; it is evidence for a person to look at.
 */

const IDLE_GAP_MS = 30_000;

type Behaviour = { activeMs: number; keystrokes: number; pastedChars: number; pasteEvents: number; blurCount: number };

export function AnswerBox({
  questionId,
  index,
  prompt,
  wordLimit,
  initial,
  disabled,
}: {
  questionId: string;
  index: number;
  prompt: string;
  wordLimit: number;
  initial: string;
  disabled: boolean;
}) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(initial ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const behaviour = useRef<Behaviour>({ activeMs: 0, keystrokes: 0, pastedChars: 0, pasteEvents: 0, blurCount: 0 });
  const lastKey = useRef<number | null>(null);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initial);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const over = words > wordLimit;

  const save = useCallback(async () => {
    setStatus("saving");
    // Counters since the last save, so the server can add them up across
    // visits; what was sent is subtracted on success, so typing during the
    // save is not lost.
    const sent = { ...behaviour.current };
    const result = await saveAnswerAction({ question_id: questionId, text: latest.current, behaviour: sent });
    if (!result.error) {
      const b = behaviour.current;
      (Object.keys(sent) as (keyof Behaviour)[]).forEach((k) => {
        b[k] = Math.max(0, b[k] - sent[k]);
      });
    }
    if (result.error) {
      setStatus("error");
      setError(result.error);
    } else {
      setStatus("saved");
      setError(null);
    }
  }, [questionId]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
  }, [save]);

  useEffect(() => {
    const onHide = () => {
      if (focused.current && document.visibilityState === "hidden") behaviour.current.blurCount += 1;
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const id = `q-${questionId}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="block text-[17px] leading-snug font-semibold">
        <span className="mr-2 text-muted-foreground tabular-nums">{index}.</span>
        {prompt}
      </Label>
      <textarea
        id={id}
        value={text}
        disabled={disabled}
        rows={8}
        aria-describedby={`${id}-meta${error ? ` ${id}-error` : ""}`}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          lastKey.current = null;
          void save();
        }}
        onKeyDown={() => {
          const now = Date.now();
          if (lastKey.current !== null && now - lastKey.current < IDLE_GAP_MS) behaviour.current.activeMs += now - lastKey.current;
          lastKey.current = now;
          behaviour.current.keystrokes += 1;
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text").length;
          behaviour.current.pastedChars += pasted;
          behaviour.current.pasteEvents += 1;
        }}
        onChange={(e) => {
          latest.current = e.target.value;
          setText(e.target.value);
          schedule();
        }}
        className={cn(
          "w-full rounded-xl border border-input bg-card px-4 py-3 text-base leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
          over && "border-destructive"
        )}
      />
      <div id={`${id}-meta`} className="flex items-center justify-between text-sm">
        <span className={cn("tabular-nums", over ? "font-medium text-destructive" : "text-muted-foreground")}>
          {words} / {wordLimit} words
        </span>
        <span aria-live="polite" className="flex items-center gap-1.5 text-muted-foreground">
          {status === "saving" ? (
            <>
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Saving
            </>
          ) : status === "saved" ? (
            <>
              <Check className="size-3.5 text-success" aria-hidden /> Saved
            </>
          ) : null}
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
