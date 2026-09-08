"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Delete, Pause, Play, Settings2, SkipForward, Volume2 } from "lucide-react";
import type { DeliveryForm, DeliveryQuestion } from "@/lib/assessment/delivery";
import { backdropFor, STOCK_LINES, strandStopped, tallyOutcome, type AdultOutcome, type MissTally } from "@/lib/assessment/story";
import type { Json } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import type { SubmitState } from "@/app/(kiosk)/sit/actions";
import { SceneBackdrop } from "./backdrops";
import { SceneProps } from "./props";
import { Tumi, type TumiMood } from "./tumi";
import { useNarrator } from "./voice";
import "./story.css";

/**
 * The story sitting. Tumi talks, the scene shows what the question is
 * about, the child answers by pointing, speaking, tapping or typing, and
 * the adult beside them records what happened on the strip at the bottom.
 * The child never needs the keyboard in the Reception and Stage 1 chapters.
 *
 * What the server sees is exactly what the paper runner sends: one
 * response per question, autosaved, then the same hand-in. The kiosk
 * never holds a key; a strand stops after a run of misses the adult
 * recorded, and the skipped items are saved as skipped.
 */

type Step =
  | { kind: "welcome" }
  | { kind: "scene"; sectionIndex: number }
  | { kind: "item"; sectionIndex: number; question: DeliveryQuestion; number: number; sceneTotal: number }
  | { kind: "reward"; sectionIndex: number }
  | { kind: "finish" };

type Responses = Record<string, Json>;

const PRAISE = STOCK_LINES.slice(0, 4);

function obj(v: Json | undefined): Record<string, Json | undefined> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : {};
}

export function StoryPlayer({
  form,
  character,
  initialResponses,
  expiresAt,
  graceSeconds,
  childName,
  submitAction,
  serverVoice = false,
}: {
  form: DeliveryForm;
  character: string;
  initialResponses: Responses;
  expiresAt: number;
  graceSeconds: number;
  childName: string;
  submitAction: (state: SubmitState) => Promise<SubmitState>;
  /** Recorded lines from the server (ElevenLabs) instead of the browser's synthesiser. */
  serverVoice?: boolean;
}) {
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [{ kind: "welcome" }];
    form.sections.forEach((s, i) => {
      out.push({ kind: "scene", sectionIndex: i });
      const total = s.questions.filter((q) => !q.isPractice).length;
      let n = 0;
      for (const q of s.questions) {
        if (!q.isPractice) n += 1;
        out.push({ kind: "item", sectionIndex: i, question: q, number: n, sceneTotal: total });
      }
      out.push({ kind: "reward", sectionIndex: i });
    });
    out.push({ kind: "finish" });
    return out;
  }, [form]);

  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Responses>(initialResponses);
  const [tally, setTally] = useState<MissTally>({});
  const [paused, setPaused] = useState(false);
  // A short celebration after a "Yes"; the rest of Tumi's mood follows the step.
  const [celebrating, setCelebrating] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showVoices, setShowVoices] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const narrator = useNarrator(serverVoice);
  const submitRef = useRef<HTMLFormElement>(null);
  const [submitState, submitFormAction, submitting] = useActionState<SubmitState>(submitAction, {});

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const timeUp = remaining === 0;

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

  const record = useCallback(
    (q: DeliveryQuestion, response: Json) => {
      setResponses((r) => ({ ...r, [q.id]: response }));
      if (!q.isPractice) void save(q.id, response);
    },
    [save],
  );

  const step = steps[index];
  const section = step.kind === "scene" || step.kind === "item" || step.kind === "reward" ? form.sections[step.sectionIndex] : null;
  const lineFor = useCallback(
    (s: Step): string => {
      switch (s.kind) {
        case "scene":
          return form.sections[s.sectionIndex].narration ?? form.sections[s.sectionIndex].title;
        case "item":
          return s.question.narration ?? s.question.stem;
        case "reward":
          return PRAISE[s.sectionIndex % PRAISE.length];
        case "finish":
          return childName ? `Thank you, ${childName}. You were a wonderful helper. Goodbye!` : STOCK_LINES[4];
        default:
          return "";
      }
    },
    [form.sections, childName],
  );

  // Tumi speaks whenever a new step opens, and the next few lines are
  // fetched in the background so a recorded voice never leaves a gap. The
  // welcome screen waits for a tap, which is also what lets the browser
  // play sound at all.
  const spokenFor = useRef<number>(-1);
  useEffect(() => {
    if (index === 0 || paused || spokenFor.current === index) return;
    spokenFor.current = index;
    narrator.speak(lineFor(step));
    for (let i = index + 1; i <= index + 3 && i < steps.length; i += 1) narrator.prefetch(lineFor(steps[i]));
  }, [index, paused, step, steps, narrator, lineFor]);

  const mood: TumiMood = paused
    ? "idle"
    : narrator.speaking
      ? "talk"
      : step.kind === "welcome" || step.kind === "finish"
        ? "wave"
        : step.kind === "reward" || celebrating
          ? "happy"
          : "idle";

  // Move on, skipping items of a strand that has stopped and saving them as
  // skipped so the marker can tell "not asked" from "not answered".
  const advance = useCallback(
    (from: number, nextTally: MissTally) => {
      let i = from + 1;
      while (i < steps.length) {
        const s = steps[i];
        if (s.kind === "item" && strandStopped(nextTally, s.question.competencyId, form.sections[s.sectionIndex].stopAfterMisses)) {
          if (s.question.type === "adult_marked" && !s.question.isPractice) void save(s.question.id, { outcome: "skipped" });
          setResponses((r) => ({ ...r, [s.question.id]: { outcome: "skipped" } }));
          i += 1;
          continue;
        }
        break;
      }
      setIndex(Math.min(steps.length - 1, i));
    },
    [steps, form.sections, save],
  );

  const adultOutcome = (outcome: AdultOutcome) => {
    if (step.kind !== "item") return;
    const q = step.question;
    record(q, { outcome });
    const next = tallyOutcome(tally, q.competencyId, outcome);
    setTally(next);
    if (outcome === "correct") {
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1800);
    }
    narrator.stop();
    advance(index, next);
  };

  const childNext = () => {
    if (step.kind !== "item") return;
    narrator.stop();
    advance(index, tally);
  };

  const begin = () => {
    setPaused(false);
    for (let i = 1; i <= 3 && i < steps.length; i += 1) narrator.prefetch(lineFor(steps[i]));
    setIndex(1);
  };

  const togglePause = () => {
    if (!paused) narrator.stop();
    setPaused((p) => !p);
    if (paused) spokenFor.current = -1;
  };

  const answeredCount = useMemo(
    () => steps.filter((s) => s.kind === "item" && !s.question.isPractice && responses[s.question.id] !== undefined).length,
    [steps, responses],
  );

  const backdrop = backdropFor(section?.sceneKey ?? (step.kind === "finish" ? "home" : "river-wake"));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="story-root fixed inset-0 z-50 flex flex-col overflow-hidden">
      {/* The stage */}
      <div className="relative flex-1 overflow-hidden">
        <SceneBackdrop backdrop={backdrop} />

        <div className="relative z-10 flex h-full flex-col">
          {/* Top line: chapter and scene */}
          <div className="flex items-center justify-between px-5 pt-3 text-sm font-semibold text-[color:var(--ink)]/70">
            <span>{childName ? `${childName} and ${character}` : `${character}'s journey`}</span>
            {section ? (
              <span>
                Scene {(step.kind === "finish" ? form.sections.length : (step as { sectionIndex: number }).sectionIndex + 1)} of {form.sections.length} · {section.title}
              </span>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 pb-4 sm:flex-row sm:items-center sm:gap-8">
            {/* Tumi and the speech bubble */}
            <div className="flex shrink-0 flex-col items-center self-end sm:w-80">
              {step.kind !== "welcome" ? (
                <div key={index} className="story-bubble relative mb-2 max-w-md rounded-3xl bg-[color:var(--bubble)] px-5 py-4 text-lg leading-snug font-medium shadow-[0_8px_0_rgba(43,45,66,0.12)] sm:text-xl">
                  {step.kind === "scene" ? (section?.narration ?? section?.title) : null}
                  {step.kind === "item" ? (step.question.narration ?? step.question.stem) : null}
                  {step.kind === "reward" ? PRAISE[step.sectionIndex % PRAISE.length] : null}
                  {step.kind === "finish" ? `Thank you, ${childName || "my friend"}! You were a wonderful helper.` : null}
                  <span className="absolute -bottom-3 left-10 size-6 rotate-45 bg-[color:var(--bubble)]" aria-hidden />
                  <button
                    type="button"
                    onClick={() => narrator.speak(lineFor(step))}
                    className="absolute -top-3 -right-3 flex size-11 items-center justify-center rounded-full bg-[color:var(--tumi-spike)] text-white shadow-md transition hover:scale-105"
                    aria-label="Say it again"
                    title="Say it again"
                  >
                    <Volume2 className="size-5" />
                  </button>
                </div>
              ) : null}
              <Tumi mood={mood} className="w-52 sm:w-72" />
            </div>

            {/* What the scene shows, and how the child answers */}
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-5 overflow-y-auto py-2">
              {step.kind === "welcome" ? <Welcome character={character} childName={childName} onBegin={begin} voiceReady={narrator.supported || narrator.recorded} /> : null}
              {step.kind === "scene" ? (
                <button type="button" onClick={() => advance(index, tally)} className="story-pop rounded-full bg-[color:var(--tumi-spike)] px-10 py-5 text-2xl font-bold text-white shadow-[0_8px_0_#d96a3f] transition hover:translate-y-0.5 hover:shadow-[0_6px_0_#d96a3f]">
                  Let&apos;s go!
                </button>
              ) : null}
              {step.kind === "item" ? (
                <>
                  <SceneProps focus={step.question.sceneFocus} big={step.question.answerMode === "adult"} />
                  <ChildAnswer question={step.question} value={responses[step.question.id]} onAnswer={(r) => record(step.question, r)} disabled={timeUp || paused} />
                </>
              ) : null}
              {step.kind === "reward" ? <Stars /> : null}
              {step.kind === "finish" ? (
                <form ref={submitRef} action={submitFormAction} className="story-pop flex flex-col items-center gap-3">
                  <p className="text-2xl font-bold">The end</p>
                  <button type="submit" disabled={submitting} className="flex items-center gap-2 rounded-full bg-[color:var(--yes)] px-8 py-4 text-xl font-bold text-white shadow-[0_6px_0_#2e8f3c] disabled:opacity-60">
                    <Check className="size-6" /> {submitting ? "Handing in…" : "Finish and hand in"}
                  </button>
                  {submitState.error ? <p className="text-sm text-[color:var(--notyet)]">{submitState.error}</p> : null}
                  {answeredCount < form.totalQuestions ? (
                    <p className="text-sm text-[color:var(--ink)]/70">
                      {form.totalQuestions - answeredCount === 1 ? "1 item was" : `${form.totalQuestions - answeredCount} items were`} not asked or not recorded.
                    </p>
                  ) : null}
                </form>
              ) : null}
            </div>
          </div>
        </div>

        {paused ? (
          <div className="story-fade absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[color:var(--ink)]/70 text-white">
            <p className="text-4xl font-bold">Paused</p>
            <button type="button" onClick={togglePause} className="flex items-center gap-2 rounded-full bg-white px-8 py-4 text-xl font-bold text-[color:var(--ink)]">
              <Play className="size-6" /> Carry on
            </button>
          </div>
        ) : null}
        {timeUp ? <p className="absolute inset-x-0 bottom-2 text-center text-sm font-semibold text-[color:var(--ink)]/70">Time is up — handing in.</p> : null}
      </div>

      {/* The adult strip */}
      <div className="relative z-30 border-t-4 border-[color:var(--ink)]/20 bg-[color:var(--strip)] text-[color:var(--strip-ink)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wider text-white/50 uppercase">For the adult</p>
            {step.kind === "item" ? (
              <p className="truncate text-base">
                <span className="font-semibold">{step.question.answerMode === "rating" ? "Rate it: " : "Look for: "}</span>
                {step.question.adultNote ?? step.question.stem}
              </p>
            ) : step.kind === "welcome" ? (
              <p className="text-base">Sit beside the child. Tap the big button when you are both ready; the sound starts then.</p>
            ) : step.kind === "scene" ? (
              <p className="text-base">Let {character} finish talking, then press Let&apos;s go.</p>
            ) : step.kind === "reward" ? (
              <p className="text-base">A little celebration. Press Next when ready.</p>
            ) : (
              <p className="text-base">Hand in when the child has finished. Nothing can be changed after this.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {step.kind === "item" && (step.question.answerMode === "adult" || step.question.answerMode === "rating" || step.question.type === "adult_marked") ? (
              <>
                <StripButton colour="var(--yes)" onClick={() => adultOutcome("correct")} disabled={timeUp || paused}>
                  Yes
                </StripButton>
                <StripButton colour="var(--partly)" onClick={() => adultOutcome("partial")} disabled={timeUp || paused}>
                  Partly
                </StripButton>
                <StripButton colour="var(--notyet)" onClick={() => adultOutcome("incorrect")} disabled={timeUp || paused}>
                  Not yet
                </StripButton>
                <StripButton ghost onClick={() => adultOutcome("skipped")} disabled={timeUp || paused}>
                  <SkipForward className="size-4" /> Skip
                </StripButton>
              </>
            ) : null}
            {step.kind === "item" && step.question.type !== "adult_marked" ? (
              <>
                <StripButton ghost onClick={childNext} disabled={timeUp || paused}>
                  <SkipForward className="size-4" /> Skip
                </StripButton>
                <StripButton colour="var(--yes)" onClick={childNext} disabled={timeUp || paused || (responses[step.question.id] === undefined && step.question.type !== "ordering")}>
                  Next
                </StripButton>
              </>
            ) : null}
            {step.kind === "reward" ? (
              <StripButton colour="var(--yes)" onClick={() => advance(index, tally)} disabled={paused}>
                Next
              </StripButton>
            ) : null}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="tabular-nums text-white/60">
              {answeredCount}/{form.totalQuestions}
              {saveState === "saving" ? " · saving" : saveState === "error" ? " · not saved" : ""}
            </span>
            <span className={cn("rounded-md px-2 py-1 font-mono tabular-nums", remaining < 300 ? "bg-[color:var(--notyet)]/40" : "bg-white/10")}>
              {mm}:{ss}
            </span>
            {step.kind !== "welcome" && step.kind !== "finish" ? (
              <button type="button" onClick={togglePause} className="rounded-md bg-white/10 p-2 hover:bg-white/20" aria-label={paused ? "Carry on" : "Pause"}>
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              </button>
            ) : null}
            <div className="relative">
              <button type="button" onClick={() => setShowVoices((v) => !v)} className="rounded-md bg-white/10 p-2 hover:bg-white/20" aria-label="Choose the voice" aria-expanded={showVoices}>
                <Settings2 className="size-4" />
              </button>
              {showVoices ? (
                <div className="absolute right-0 bottom-12 z-40 w-72 rounded-xl bg-white p-3 text-[color:var(--ink)] shadow-xl">
                  <p className="text-xs font-semibold tracking-wide text-[color:var(--ink)]/60 uppercase">Voice</p>
                  {narrator.recorded ? (
                    <p className="mt-1 text-sm">{character}&apos;s lines are recorded. If a recording cannot be fetched, the browser voice below reads the line instead.</p>
                  ) : null}
                  {narrator.supported ? (
                    <select
                      value={narrator.voiceName ?? ""}
                      onChange={(e) => narrator.chooseVoice(e.target.value || null)}
                      className="mt-1 w-full rounded-md border border-[color:var(--ink)]/20 px-2 py-2 text-sm"
                      aria-label="Voice"
                    >
                      {narrator.voices
                        .filter((v) => v.lang.toLowerCase().startsWith("en"))
                        .map((v) => (
                          <option key={v.name} value={v.name}>
                            {v.name} ({v.lang})
                          </option>
                        ))}
                    </select>
                  ) : (
                    <p className="mt-1 text-sm">This browser cannot speak. Read {character}&apos;s words aloud from the bubble.</p>
                  )}
                  {!narrator.recorded ? (
                    <p className="mt-2 text-xs text-[color:var(--ink)]/60">A soft female English voice is chosen automatically. On Windows, Edge&apos;s “Online (Natural)” voices sound best.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {step.kind !== "finish" ? <form ref={submitRef} action={submitFormAction} className="hidden" aria-hidden /> : null}
    </div>
  );
}

function StripButton({ children, colour, ghost, onClick, disabled }: { children: React.ReactNode; colour?: string; ghost?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={colour && !ghost ? { backgroundColor: colour } : undefined}
      className={cn(
        "flex min-h-12 items-center gap-1.5 rounded-xl px-5 text-base font-bold transition disabled:opacity-40",
        ghost ? "bg-white/10 text-white hover:bg-white/20" : "text-white shadow-[0_4px_0_rgba(0,0,0,0.25)] hover:brightness-110 active:translate-y-0.5 active:shadow-none",
      )}
    >
      {children}
    </button>
  );
}

function Welcome({ character, childName, onBegin, voiceReady }: { character: string; childName: string; onBegin: () => void; voiceReady: boolean }) {
  return (
    <div className="story-pop flex flex-col items-center gap-5 text-center">
      <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">{character}&apos;s Journey</h1>
      <p className="max-w-md text-xl text-[color:var(--ink)]/80">{childName ? `${childName}, ` : ""}a little dinosaur needs your help to find the way home.</p>
      <button type="button" onClick={onBegin} className="rounded-full bg-[color:var(--tumi-spike)] px-12 py-6 text-3xl font-bold text-white shadow-[0_8px_0_#d96a3f] transition hover:translate-y-0.5 hover:shadow-[0_6px_0_#d96a3f]">
        Start the story
      </button>
      {!voiceReady ? <p className="text-sm text-[color:var(--ink)]/60">This computer cannot speak, so the adult reads the words in the bubble.</p> : null}
    </div>
  );
}

function Stars() {
  const stars = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        const r = 120 + (i % 3) * 50;
        return { dx: `${Math.cos(a) * r}px`, dy: `${Math.sin(a) * r - 40}px`, delay: `${(i % 5) * 60}ms`, colour: ["#ffd166", "#ff8a5b", "#63b6ff", "#a3e635"][i % 4] };
      }),
    [],
  );
  return (
    <div className="relative flex h-64 w-full items-center justify-center">
      <p className="story-pop text-5xl font-bold">Well done!</p>
      {stars.map((s, i) => (
        <svg key={i} viewBox="0 0 24 24" width="34" height="34" className="story-star" style={{ "--dx": s.dx, "--dy": s.dy, animationDelay: s.delay } as React.CSSProperties} aria-hidden>
          <path d="M12 2 L14.9 8.6 22 9.3 16.6 14.1 18.2 21 12 17.4 5.8 21 7.4 14.1 2 9.3 9.1 8.6 Z" fill={s.colour} />
        </svg>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* How the child answers on screen (tap, type, drag). Pointing and speaking  */
/* need nothing here: the adult records those.                               */
/* ------------------------------------------------------------------------ */

const TAP_COLOURS = ["#4a7bd1", "#5faa47", "#ff8a1e", "#9b5de5"];

function ChildAnswer({ question: q, value, onAnswer, disabled }: { question: DeliveryQuestion; value: Json | undefined; onAnswer: (r: Json) => void; disabled: boolean }) {
  const v = obj(value);
  const mode = q.answerMode ?? (q.type === "adult_marked" ? "adult" : q.type === "single_choice" ? "tap" : q.type === "ordering" ? "drag" : "type");
  if (mode === "adult" || mode === "rating" || q.type === "adult_marked") return null;

  if (q.type === "single_choice" || q.type === "multi_select") {
    const ids = q.type === "multi_select" && Array.isArray(v.option_ids) ? (v.option_ids as string[]) : [];
    return (
      <div className="flex flex-wrap items-stretch justify-center gap-3">
        {q.options.map((o, i) => {
          const chosen = q.type === "single_choice" ? v.option_id === o.id : ids.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => (q.type === "single_choice" ? onAnswer({ option_id: o.id }) : onAnswer({ option_ids: chosen ? ids.filter((x) => x !== o.id) : [...ids, o.id] }))}
              style={{ backgroundColor: chosen ? TAP_COLOURS[i % TAP_COLOURS.length] : "#fff", color: chosen ? "#fff" : "var(--ink)", borderColor: TAP_COLOURS[i % TAP_COLOURS.length] }}
              className="story-pop min-h-16 min-w-40 rounded-2xl border-4 px-6 py-3 text-2xl font-bold shadow-[0_6px_0_rgba(43,45,66,0.15)] transition active:translate-y-1 active:shadow-none"
              aria-pressed={chosen}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (q.type === "numeric") return <NumberPad value={typeof v.value === "string" || typeof v.value === "number" ? String(v.value) : ""} onChange={(s) => onAnswer({ value: s })} disabled={disabled} />;

  if (q.type === "short_text" || q.type === "extended_text") {
    return (
      <input
        type="text"
        disabled={disabled}
        defaultValue={typeof v.text === "string" ? v.text : ""}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onAnswer({ text: e.target.value })}
        className="h-20 w-full max-w-lg rounded-2xl border-4 border-[color:var(--ink)]/60 bg-white px-5 text-3xl font-semibold outline-none focus-visible:border-[color:var(--tumi-spike)]"
        aria-label="Your answer"
      />
    );
  }

  if (q.type === "ordering") return <TapToOrder q={q} value={v} onAnswer={onAnswer} disabled={disabled} />;
  return null;
}

function NumberPad({ value, onChange, disabled }: { value: string; onChange: (s: string) => void; disabled: boolean }) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === "⌫") onChange(value.slice(0, -1));
    else if (value.length < 6) onChange(value + k);
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, "").slice(0, 8))}
        className="h-20 w-56 rounded-2xl border-4 border-[color:var(--ink)]/60 bg-white text-center text-5xl font-bold tabular-nums outline-none focus-visible:border-[color:var(--tumi-spike)]"
        aria-label="Your number"
      />
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => press(k)}
              className="flex size-16 items-center justify-center rounded-2xl bg-white text-3xl font-bold shadow-[0_5px_0_rgba(43,45,66,0.15)] transition active:translate-y-1 active:shadow-none"
              aria-label={k === "⌫" ? "Delete" : k}
            >
              {k === "⌫" ? <Delete className="size-7" /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function TapToOrder({ q, value, onAnswer, disabled }: { q: DeliveryQuestion; value: Record<string, Json | undefined>; onAnswer: (r: Json) => void; disabled: boolean }) {
  const saved = Array.isArray(value.order) ? (value.order as string[]) : null;
  const order = saved && saved.length === q.options.length ? saved : q.options.map((o) => o.id);
  const [picked, setPicked] = useState<string | null>(null);
  const label = new Map(q.options.map((o) => [o.id, o.label]));
  const tap = (id: string) => {
    if (disabled) return;
    if (!picked) {
      setPicked(id);
      return;
    }
    if (picked === id) {
      setPicked(null);
      return;
    }
    const next = [...order];
    const a = next.indexOf(picked);
    const b = next.indexOf(id);
    [next[a], next[b]] = [next[b], next[a]];
    setPicked(null);
    onAnswer({ order: next });
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-base font-semibold text-[color:var(--ink)]/70">Tap two to swap them</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {order.map((id, i) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => tap(id)}
            className={cn(
              "flex min-h-16 min-w-32 items-center gap-3 rounded-2xl border-4 bg-white px-5 py-3 text-2xl font-bold shadow-[0_6px_0_rgba(43,45,66,0.15)] transition",
              picked === id ? "-translate-y-2 border-[color:var(--tumi-spike)]" : "border-[color:var(--ink)]/30",
            )}
            aria-pressed={picked === id}
          >
            <span className="text-sm text-[color:var(--ink)]/50">{i + 1}</span>
            {label.get(id)}
          </button>
        ))}
      </div>
    </div>
  );
}
