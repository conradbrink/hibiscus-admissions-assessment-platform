/**
 * Story mode, the pure parts: how a focus token becomes a drawing, which
 * backdrop a scene uses, which voice reads the story, and when a strand
 * stops. The player (components/kiosk/story) draws and talks; this file
 * decides, so it can be tested without a browser.
 */

export type Focus = {
  /** The token before the colon: "apples", "cards", "clock", "text". */
  kind: string;
  /** Comma-separated arguments, or the single raw argument for free text kinds. */
  args: string[];
  /** The argument as written, for kinds that carry prose. */
  raw: string;
  /** A trailing "!" on the token: draw this one bigger and pulsing. */
  highlight: boolean;
};

/** Kinds whose argument is prose, never split on commas. */
const PROSE_KINDS = new Set(["text", "sentence", "words", "sign", "word", "sum", "number", "letter"]);

export function parseFocus(token: string): Focus {
  const trimmed = token.trim();
  const colon = trimmed.indexOf(":");
  let kind = colon < 0 ? trimmed : trimmed.slice(0, colon);
  let raw = colon < 0 ? "" : trimmed.slice(colon + 1);
  let highlight = false;
  if (raw.endsWith("!")) {
    highlight = true;
    raw = raw.slice(0, -1);
  } else if (kind.endsWith("!")) {
    highlight = true;
    kind = kind.slice(0, -1);
  }
  kind = kind.toLowerCase();
  const args = raw === "" ? [] : PROSE_KINDS.has(kind) ? [raw] : raw.split(",").map((a) => a.trim()).filter(Boolean);
  return { kind, args, raw, highlight };
}

/**
 * A count argument: "3", "2+1" (a group and one more), "5-2" (five with two
 * taken away), "3x5" (rows by columns), "4x9+6" (rows by columns plus a
 * remainder), "many" (a heap). Anything else is a heap too.
 */
export type CountSpec =
  | { shape: "count"; n: number }
  | { shape: "plus"; a: number; b: number }
  | { shape: "minus"; a: number; b: number }
  | { shape: "array"; rows: number; cols: number; extra: number }
  | { shape: "heap" };

export function parseCount(arg: string | undefined): CountSpec {
  if (!arg) return { shape: "count", n: 1 };
  const s = arg.replace(/\s+/g, "").toLowerCase();
  let m = /^(\d+)x(\d+)(?:\+(\d+))?$/.exec(s);
  if (m) return { shape: "array", rows: Number(m[1]), cols: Number(m[2]), extra: Number(m[3] ?? 0) };
  m = /^(\d+)\+(\d+)$/.exec(s);
  if (m) return { shape: "plus", a: Number(m[1]), b: Number(m[2]) };
  m = /^(\d+)-(\d+)$/.exec(s);
  if (m) return { shape: "minus", a: Number(m[1]), b: Number(m[2]) };
  if (/^\d+$/.test(s)) return { shape: "count", n: Math.min(60, Number(s)) };
  return { shape: "heap" };
}

export type Backdrop = "river" | "path" | "market" | "village" | "hill" | "home" | "letter";

/** Which drawn world a scene lives in. Unknown keys get the river. */
export function backdropFor(sceneKey: string | null | undefined): Backdrop {
  const k = (sceneKey ?? "").toLowerCase();
  if (k === "home") return "home";
  if (k.startsWith("hill") || k === "map" || k === "steps" || k === "rain-chart" || k === "writing") return "hill";
  if (k === "letter" || k === "note") return "letter";
  if (k.startsWith("village") || k === "shop" || k === "square" || k === "clock-tower" || k === "story2") return "village";
  if (k.startsWith("market") || k === "notice" || k === "oranges" || k === "drum" || k === "pie") return "market";
  if (k === "signpost" || k === "shape-path") return "path";
  return "river";
}

export type VoiceLike = { name: string; lang: string; default?: boolean; localService?: boolean };

const FRIENDLY_NAMES = [
  "libby", "sonia", "hazel", "susan", "mia", "maisie", "olivia", "abbi", "bella", "hollie",
  "leah", "natasha", "molly", "emily", "aria", "jenny", "samantha", "karen", "moira", "fiona",
  "tessa", "kate", "serena", "zira", "female", "google uk english female",
];
const AVOID_NAMES = ["male", "daniel", "george", "ryan", "thomas", "oliver", "alfie", "noah", "william", "james", "guy", "david", "mark", "arthur", "fred", "eddy", "reed", "rocko", "grandpa", "bad news", "bubbles", "cellos", "zarvox", "trinoids", "whisper", "wobble"];

function langRank(lang: string): number {
  const l = lang.toLowerCase().replace("_", "-");
  if (l === "en-za") return 0;
  if (l === "en-gb") return 1;
  if (l === "en-ie" || l === "en-au" || l === "en-nz") return 2;
  if (l.startsWith("en")) return 3;
  return 9;
}

/**
 * The voice that reads the story: an English voice, Southern African or
 * British by preference, warm and clear, natural-sounding when the device
 * has one. Returns null when nothing speaks English; the player then
 * shows the words and lets the adult read them.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const v of voices) {
    const rank = langRank(v.lang);
    if (rank >= 9) continue;
    const name = v.name.toLowerCase();
    let score = rank * 10;
    // A soft female voice first, whatever the accent; a male voice only when
    // the device has nothing else in English.
    if (FRIENDLY_NAMES.some((n) => name.includes(n))) score -= 8;
    if (AVOID_NAMES.some((n) => name.includes(n))) score += 40;
    if (name.includes("natural") || name.includes("neural") || name.includes("online") || name.includes("google")) score -= 2;
    if (name.includes("compact") || name.includes("espeak")) score += 5;
    if (score < bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

/** How Tumi speaks: softly, a little slower than a newsreader, a touch brighter. */
export const VOICE_STYLE = { rate: 0.88, pitch: 1.08, volume: 0.95 } as const;

export type AdultOutcome = "correct" | "partial" | "incorrect" | "skipped";

/** Consecutive misses per competency, as the adult records outcomes. */
export type MissTally = Record<string, number>;

export function tallyOutcome(tally: MissTally, competencyId: string, outcome: AdultOutcome): MissTally {
  const next = { ...tally };
  if (outcome === "incorrect") next[competencyId] = (tally[competencyId] ?? 0) + 1;
  else if (outcome === "correct" || outcome === "partial") next[competencyId] = 0;
  return next;
}

/** Whether a strand has stopped: after `stopAfter` misses in a row. Null never stops. */
export function strandStopped(tally: MissTally, competencyId: string, stopAfter: number | null): boolean {
  if (!stopAfter || stopAfter <= 0) return false;
  return (tally[competencyId] ?? 0) >= stopAfter;
}

/** Rain in Gaborone, the chart the Stage 3 hill questions read. Millimetres. */
export const RAIN_CHART: ReadonlyArray<{ month: string; mm: number }> = [
  { month: "Nov", mm: 40 },
  { month: "Dec", mm: 90 },
  { month: "Jan", mm: 110 },
  { month: "Feb", mm: 80 },
  { month: "Mar", mm: 50 },
  { month: "Apr", mm: 20 },
];
