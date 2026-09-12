import { readFileSync } from "node:fs";
import path from "node:path";
import { StoryPlayer } from "@/components/kiosk/story/story-player";
import { storyVoiceProvider } from "@/lib/assessment/story-voice";
import { devShortcutsAllowed } from "@/lib/deployment";
import { requireStaff } from "@/lib/staff/session";
import type { DeliveryForm } from "@/lib/assessment/delivery";
import type { SubmitState } from "../actions";

type Item = { code: string; competency: string; difficulty: number; narration: string; focus: string[]; mode: "adult" | "rating" | "tap" | "type" | "drag"; type: "adult_marked" | "single_choice" | "numeric" | "ordering" | "short_text"; marks: number; options?: string[]; note?: string };
type Chapter = { name: string; character: string; stop_after_misses: number; scenes: { key: string; title: string; narration: string; sees: string; items: Item[] }[] };

/**
 * A walk through a story chapter with no attempt behind it, for looking at
 * the player. Open on a preview deployment; on the live site only a
 * signed-in staff member can see it. There is no sitting, nothing is
 * saved, and the hand-in does nothing.
 */

async function noop(): Promise<SubmitState> {
  "use server";
  return {};
}

// Named for their story, not their stage: the chapters moved up a stage in
// September 2026, and a code called "stage1" holding Stage 2's assessment is
// a trap for whoever edits it next. "hill" is retired but still previewable.
const CHAPTERS = new Set(["garden", "river", "village", "market", "hill"]);

/** An hour from the request; a server component reads the clock once per request. */
function previewExpiry(): number {
  return new Date().getTime() + 3600_000;
}

export default async function Preview({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  // The walk-through renders real questions. Anywhere but a developer's own
  // machine it asks who you are — a preview deployment is a deployment.
  if (!devShortcutsAllowed()) await requireStaff("assessments.deliver");
  const { c } = await searchParams;
  const code = c && CHAPTERS.has(c) ? c : "garden";
  const chapter = JSON.parse(readFileSync(path.join(process.cwd(), "content", "story", `${code}.json`), "utf8")) as Chapter;
  const total = chapter.scenes.reduce((n, s) => n + s.items.length, 0);
  const expiresAt = previewExpiry();
  const form: DeliveryForm = {
    formId: "preview",
    sections: chapter.scenes.map((s, si) => ({
      position: si + 1,
      title: s.title,
      instructions: s.sees,
      timeLimitSeconds: null,
      sceneKey: s.key,
      narration: s.narration,
      stopAfterMisses: chapter.stop_after_misses,
      questions: s.items.map((it, qi) => {
        return {
          id: `${it.code}`,
          sectionPosition: si + 1,
          position: qi + 1,
          isPractice: false,
          type: it.type,
          stem: it.narration,
          stemMediaPath: null,
          passage: null,
          options: (it.options ?? []).map((label, i) => ({ id: `${it.code}-${i}`, label, mediaPath: null, side: null })),
          marks: it.marks,
          competencyId: it.competency,
          difficulty: it.difficulty,
          narration: it.narration,
          answerMode: it.mode,
          sceneFocus: it.focus,
          adultNote: it.note ?? null,
        };
      }),
    })),
    totalQuestions: total,
  };
  return <StoryPlayer form={form} character={chapter.character} initialResponses={{}} expiresAt={expiresAt} graceSeconds={60} childName="Naledi" submitAction={noop} serverVoice={storyVoiceProvider() === "elevenlabs"} />;
}
