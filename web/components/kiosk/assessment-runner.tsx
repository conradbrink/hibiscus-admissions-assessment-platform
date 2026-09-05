"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { DeliveryForm, DeliveryQuestion } from "@/lib/assessment/delivery";
import type { Json } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import type { SubmitState } from "@/app/(kiosk)/sit/actions";

/**
 * One thing on the screen at a time: a section's instructions, or one
 * question. Big targets, a plain countdown, and an autosave after every
 * answer so a crashed browser loses at most one.
 *
 * The clock shown here is a courtesy. The server's clock decides; when it
 * runs out this component hands the paper in, and if it cannot, the expiry
 * sweep does.
 */

type Step = { kind: "intro"; sectionIndex: number } | { kind: "question"; question: DeliveryQuestion; number: number };

type Responses = Record<string, Json>;

function obj(v: Json | undefined): Record<string, Json | undefined> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : {};
}

export function AssessmentRunner({
  form,
  initialResponses,
  expiresAt,
  graceSeconds,
  childName,
  submitAction,
}: {
  form: DeliveryForm;
  initialResponses: Responses;
  expiresAt: number;
  graceSeconds: number;
  childName: string;
  submitAction: (state: SubmitState) => Promise<SubmitState>;
}) {
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    let n = 0;
    form.sections.forEach((s, i) => {
      out.push({ kind: "intro", sectionIndex: i });
      for (const q of s.questions) {
        if (!q.isPractice) n += 1;
        out.push({ kind: "question", question: q, number: q.isPractice ? 0 : n });
      }
    });
    return out;
  }, [form]);

  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Responses>(initialResponses);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const submitRef = useRef<HTMLFormElement>(null);
  const [submitState, submitFormAction, submitting] = useActionState<SubmitState>(submitAction, {});

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const timeUp = remaining === 0;

  // When the clock runs out, hand in — once. The grace period on the server
  // covers the round trip.
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (timeUp && !autoSubmitted.current) {
      autoSubmitted.current = true;
      const t = setTimeout(() => submitRef.current?.requestSubmit(), Math.min(2000, graceSeconds * 500));
      return () => clearTimeout(t);
    }
  }, [timeUp, graceSeconds]);

  const save = useCallback(async (formQuestionId: string, response: Json) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/sit/response", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formQuestionId, response }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }, []);

  const answer = useCallback(
    (q: DeliveryQuestion, response: Json) => {
      setResponses((r) => ({ ...r, [q.id]: response }));
      if (q.isPractice) return;
      clearTimeout(timers.current[q.id]);
      timers.current[q.id] = setTimeout(() => void save(q.id, response), 400);
    },
    [save]
  );

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const answered = useMemo(
    () => steps.filter((s) => s.kind === "question" && !s.question.isPractice && responses[s.question.id] !== undefined).length,
    [steps, responses]
  );

  const goNext = () => {
    // Flush a pending save before moving on.
    if (step.kind === "question" && !step.question.isPractice && timers.current[step.question.id]) {
      clearTimeout(timers.current[step.question.id]);
      void save(step.question.id, responses[step.question.id] ?? null);
    }
    setIndex((i) => Math.min(steps.length - 1, i + 1));
    window.scrollTo({ top: 0 });
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div>
          <p className="font-semibold">{childName ? `${childName}'s assessment` : "Assessment"}</p>
          <p className="text-muted-foreground">
            {answered} of {form.totalQuestions} answered
            <span className="ml-2">
              {saveState === "saving" ? "· saving…" : saveState === "saved" ? "· saved" : saveState === "error" ? "· not saved, will retry" : ""}
            </span>
          </p>
        </div>
        <p
          className={cn(
            "rounded-lg px-3 py-1.5 font-mono text-lg font-semibold tabular-nums",
            remaining < 300 ? "bg-warning/25 text-warning-foreground" : "bg-muted"
          )}
          aria-live="polite"
        >
          {mm}:{ss}
        </p>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-border" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((100 * (index + 1)) / steps.length)}%` }} />
      </div>

      {step.kind === "intro" ? (
        <section className="rounded-2xl border border-border bg-card p-6">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Part {step.sectionIndex + 1} of {form.sections.length}</p>
          <h1 className="mt-1 text-2xl font-bold">{form.sections[step.sectionIndex].title}</h1>
          {form.sections[step.sectionIndex].instructions ? (
            <p className="mt-3 text-lg leading-relaxed">{form.sections[step.sectionIndex].instructions}</p>
          ) : null}
          <p className="mt-3 text-base text-muted-foreground">{form.sections[step.sectionIndex].questions.filter((q) => !q.isPractice).length} questions.</p>
        </section>
      ) : (
        <QuestionView key={step.question.id} question={step.question} number={step.number} value={responses[step.question.id]} onAnswer={(r) => answer(step.question, r)} disabled={timeUp} />
      )}

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0 || submitting}>
          <ArrowLeft data-icon="inline-start" /> Back
        </Button>
        {isLast ? (
          <form
            ref={submitRef}
            action={submitFormAction}
            onSubmit={(e) => {
              if (!timeUp && answered < form.totalQuestions && !window.confirm(`You have ${form.totalQuestions - answered} unanswered. Hand in anyway?`)) {
                e.preventDefault();
              }
            }}
          >
            <Button type="submit" size="lg" variant="success" disabled={submitting}>
              <Check data-icon="inline-start" /> {submitting ? "Handing in…" : "Finish and hand in"}
            </Button>
            {submitState.error ? <p className="mt-1 text-xs text-destructive">{submitState.error}</p> : null}
          </form>
        ) : (
          <Button type="button" size="lg" onClick={goNext} disabled={submitting}>
            {step.kind === "intro" ? "Start" : "Next"} <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
      {!isLast ? (
        <form ref={submitRef} action={submitFormAction} className="hidden" aria-hidden />
      ) : null}
      {timeUp ? <p className="text-center text-sm text-muted-foreground">Time is up — handing in your answers.</p> : null}
    </div>
  );
}

function QuestionView({
  question: q,
  number,
  value,
  onAnswer,
  disabled,
}: {
  question: DeliveryQuestion;
  number: number;
  value: Json | undefined;
  onAnswer: (r: Json) => void;
  disabled: boolean;
}) {
  const v = obj(value);
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">{q.isPractice ? "Practice — have a go" : `Question ${number}`}</p>
      {q.passage ? (
        <div className="mt-3 rounded-xl bg-muted/60 p-4">
          <p className="text-sm font-semibold">{q.passage.title}</p>
          <p className="mt-1 text-base leading-relaxed whitespace-pre-line">{q.passage.body}</p>
        </div>
      ) : null}
      <h2 className="mt-3 text-xl leading-relaxed font-semibold whitespace-pre-line">{q.stem}</h2>
      <div className="mt-5">
        {q.type === "single_choice" ? (
          <div className="grid gap-2">
            {q.options.map((o) => {
              const chosen = v.option_id === o.id;
              return (
                <button key={o.id} type="button" disabled={disabled} onClick={() => onAnswer({ option_id: o.id })}
                  className={cn("min-h-14 rounded-xl border-2 px-4 py-3 text-left text-lg transition-colors", chosen ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted")}
                  aria-pressed={chosen}>
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {q.type === "multi_select" ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">Choose all that are right.</p>
            {q.options.map((o) => {
              const ids = Array.isArray(v.option_ids) ? (v.option_ids as string[]) : [];
              const chosen = ids.includes(o.id);
              return (
                <button key={o.id} type="button" disabled={disabled}
                  onClick={() => onAnswer({ option_ids: chosen ? ids.filter((x) => x !== o.id) : [...ids, o.id] })}
                  className={cn("min-h-14 rounded-xl border-2 px-4 py-3 text-left text-lg transition-colors", chosen ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted")}
                  aria-pressed={chosen}>
                  {chosen ? "☑ " : "☐ "}{o.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {q.type === "numeric" ? (
          <input type="text" inputMode="decimal" disabled={disabled} defaultValue={typeof v.value === "string" || typeof v.value === "number" ? String(v.value) : ""}
            onChange={(e) => onAnswer({ value: e.target.value })}
            className="h-16 w-full max-w-xs rounded-xl border-2 border-input bg-background px-4 text-2xl outline-none focus-visible:border-ring" aria-label="Your answer" />
        ) : null}
        {q.type === "short_text" ? (
          <input type="text" disabled={disabled} defaultValue={typeof v.text === "string" ? v.text : ""} autoComplete="off" spellCheck={false}
            onChange={(e) => onAnswer({ text: e.target.value })}
            className="h-16 w-full rounded-xl border-2 border-input bg-background px-4 text-2xl outline-none focus-visible:border-ring" aria-label="Your answer" />
        ) : null}
        {q.type === "extended_text" ? (
          <Textarea disabled={disabled} rows={10} defaultValue={typeof v.text === "string" ? v.text : ""} onChange={(e) => onAnswer({ text: e.target.value })} className="text-lg leading-relaxed" aria-label="Your writing" />
        ) : null}
        {q.type === "matching" ? <Matching q={q} value={v} onAnswer={onAnswer} disabled={disabled} /> : null}
        {q.type === "ordering" ? <Ordering q={q} value={v} onAnswer={onAnswer} disabled={disabled} /> : null}
      </div>
    </section>
  );
}

function Matching({ q, value, onAnswer, disabled }: { q: DeliveryQuestion; value: Record<string, Json | undefined>; onAnswer: (r: Json) => void; disabled: boolean }) {
  const left = q.options.filter((o) => o.side !== "right");
  const right = q.options.filter((o) => o.side === "right");
  const pairs = new Map<string, string>();
  if (Array.isArray(value.pairs)) for (const p of value.pairs) if (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string") pairs.set(p[0], p[1]);
  const set = (l: string, r: string) => {
    if (r) pairs.set(l, r);
    else pairs.delete(l);
    onAnswer({ pairs: [...pairs.entries()] });
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Match each one on the left with one on the right.</p>
      {left.map((l) => (
        <div key={l.id} className="grid grid-cols-2 items-center gap-3">
          <span className="text-lg">{l.label}</span>
          <NativeSelect value={pairs.get(l.id) ?? ""} disabled={disabled} onChange={(e) => set(l.id, e.target.value)} className="h-14 text-lg md:h-14 md:text-lg" aria-label={`Match for ${l.label}`}>
            <option value="">Choose…</option>
            {right.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </NativeSelect>
        </div>
      ))}
    </div>
  );
}

function Ordering({ q, value, onAnswer, disabled }: { q: DeliveryQuestion; value: Record<string, Json | undefined>; onAnswer: (r: Json) => void; disabled: boolean }) {
  const saved = Array.isArray(value.order) ? (value.order as string[]) : null;
  const order = saved && saved.length === q.options.length ? saved : q.options.map((o) => o.id);
  const label = new Map(q.options.map((o) => [o.id, o.label]));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onAnswer({ order: next });
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Put these in the right order, top to bottom.</p>
      {order.map((id, i) => (
        <div key={id} className="flex items-center gap-2 rounded-xl border-2 border-border bg-background px-4 py-2">
          <span className="w-6 text-sm font-semibold text-muted-foreground">{i + 1}.</span>
          <span className="flex-1 text-lg">{label.get(id)}</span>
          <Button type="button" size="icon-lg" variant="outline" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ChevronUp /></Button>
          <Button type="button" size="icon-lg" variant="outline" disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ChevronDown /></Button>
        </div>
      ))}
    </div>
  );
}
