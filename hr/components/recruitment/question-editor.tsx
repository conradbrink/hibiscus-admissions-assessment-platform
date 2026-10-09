"use client";

import { useActionState, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Sparkles, Trash2 } from "lucide-react";
import type { StaffActionState } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type EditableQuestion = {
  id: string;
  prompt: string;
  competency: string;
  word_limit: number;
  origin: "bank" | "ai" | "manual";
  status: "draft" | "approved";
  ai_rationale: string | null;
  bands: { band: number; descriptor: string }[];
};

const COMPETENCIES: ReadonlyArray<readonly [string, string]> = [
  ["safeguarding", "Safeguarding"],
  ["pedagogy", "Teaching and learning"],
  ["classroom_management", "Classroom management"],
  ["inclusion", "Inclusion"],
  ["assessment", "Assessment"],
  ["communication", "Communication"],
  ["professionalism", "Professionalism"],
  ["subject_knowledge", "Subject knowledge"],
  ["early_years_practice", "Early years practice"],
  ["teamwork", "Teamwork"],
];

const BAND_NAMES = ["0 · No answer", "1 · Weak", "2 · Adequate", "3 · Good", "4 · Excellent"];

/**
 * The questions one vacancy will ask, and the rubric each is marked against.
 * The AI drafts, a person edits and approves; nothing reaches applicants
 * until every question is approved and the vacancy is published.
 */
export function QuestionEditor({
  questions,
  locked,
  actions,
}: {
  questions: EditableQuestion[];
  locked: boolean;
  actions: {
    draft: () => Promise<StaffActionState & { note?: string | null }>;
    save: (questionId: string | null, state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
    approve: (ids: string[], approve: boolean) => Promise<StaffActionState>;
    remove: (id: string) => Promise<StaffActionState>;
    move: (id: string, direction: "up" | "down") => Promise<StaffActionState>;
  };
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const drafts = questions.filter((q) => q.status === "draft").map((q) => q.id);

  const run = (fn: () => Promise<StaffActionState & { note?: string | null }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) setMessage({ tone: "error", text: r.error });
      else if (r.note) setMessage({ tone: "info", text: r.note });
      else setMessage(null);
    });

  return (
    <div className="space-y-5">
      {!locked ? (
        <div className="surface flex flex-wrap items-center gap-3 p-5">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Draft with AI</p>
            <p className="text-sm text-muted-foreground">Tailors the bank to this post&apos;s subject and grades, and adds one to three questions. Replaces the current drafts; approved questions stay.</p>
          </div>
          <Button type="button" size="lg" disabled={pending} onClick={() => run(actions.draft)}>
            <Sparkles aria-hidden /> {pending ? "Drafting…" : "Draft questions"}
          </Button>
          {drafts.length ? (
            <Button type="button" variant="outline" size="lg" disabled={pending} onClick={() => run(() => actions.approve(drafts, true))}>
              <Check aria-hidden /> Approve all {drafts.length}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm">This vacancy is published, so its questions are frozen. Every applicant answers exactly these, marked against exactly these rubrics.</p>
      )}
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("text-sm", message.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
          {message.text}
        </p>
      ) : null}

      <ol className="space-y-3">
        {questions.map((q, i) => (
          <li key={q.id} className="surface p-5">
            {editing === q.id ? (
              <QuestionForm question={q} action={(st, fd) => actions.save(q.id, st, fd)} onDone={() => setEditing(null)} />
            ) : (
              <>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="mt-0.5 text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="leading-snug font-medium">{q.prompt}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn("rounded-full px-2 py-0.5 font-semibold", q.status === "approved" ? "bg-success/12 text-success" : "bg-warning/30 text-warning-foreground")}>
                        {q.status === "approved" ? "Approved" : "Draft"}
                      </span>
                      <span>{COMPETENCIES.find(([k]) => k === q.competency)?.[1] ?? q.competency}</span>
                      <span>·</span>
                      <span>{q.word_limit} words</span>
                      <span>·</span>
                      <span>{q.origin === "bank" ? "From the bank" : q.origin === "ai" ? "Written by AI" : "Written by staff"}</span>
                    </p>
                    {q.ai_rationale ? <p className="mt-1 text-xs text-muted-foreground italic">{q.ai_rationale}</p> : null}
                  </div>
                  {!locked ? (
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={pending || i === 0} onClick={() => run(() => actions.move(q.id, "up"))}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={pending || i === questions.length - 1} onClick={() => run(() => actions.move(q.id, "down"))}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(q.id)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm("Delete this question?")) run(() => actions.remove(q.id));
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                      {q.status === "draft" ? (
                        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => actions.approve([q.id], true))}>
                          Approve
                        </Button>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(() => actions.approve([q.id], false))}>
                          Unapprove
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
                <details className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Marking rubric</summary>
                  <dl className="mt-2 space-y-1.5">
                    {q.bands.map((b) => (
                      <div key={b.band} className="grid grid-cols-[7rem_1fr] gap-2">
                        <dt className="font-medium">{BAND_NAMES[b.band]}</dt>
                        <dd className="text-muted-foreground">{b.descriptor}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </>
            )}
          </li>
        ))}
      </ol>

      {!locked ? (
        editing === "new" ? (
          <div className="surface p-5">
            <QuestionForm question={null} action={(st, fd) => actions.save(null, st, fd)} onDone={() => setEditing(null)} />
          </div>
        ) : (
          <Button type="button" variant="outline" size="lg" onClick={() => setEditing("new")}>
            Add a question
          </Button>
        )
      ) : null}
    </div>
  );
}

function QuestionForm({
  question,
  action,
  onDone,
}: {
  question: EditableQuestion | null;
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (s: StaffActionState, fd: FormData) => {
    const r = await action(s, fd);
    if (r.ok) onDone();
    return r;
  }, {});
  const bands = question?.bands ?? [0, 1, 2, 3, 4].map((band) => ({ band, descriptor: band === 0 ? "No answer, or an answer that does not address the question." : "" }));
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="prompt">Question</Label>
        <Textarea id="prompt" name="prompt" defaultValue={question?.prompt} rows={3} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="competency">What it tests</Label>
          <NativeSelect id="competency" name="competency" defaultValue={question?.competency ?? "pedagogy"}>
            {COMPETENCIES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="word_limit">Word limit</Label>
          <Input id="word_limit" name="word_limit" type="number" min={50} max={800} defaultValue={question?.word_limit ?? 250} />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Rubric: what an answer at each band shows</legend>
        {bands.map((b) => (
          <div key={b.band} className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-3">
            <Label htmlFor={`band_${b.band}`} className="pt-2">
              {BAND_NAMES[b.band]}
            </Label>
            <Textarea id={`band_${b.band}`} name={`band_${b.band}`} defaultValue={b.descriptor} rows={2} required />
          </div>
        ))}
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save as draft"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
