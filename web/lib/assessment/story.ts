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

/**
 * One line of narration as the voice service receives it: trimmed, single
 * spaces, capped so a runaway string cannot become a runaway bill. The
 * cache key is built from this, so two spellings of the same line share
 * one recording.
 */
export const MAX_NARRATION_CHARS = 1200;

export function normaliseNarration(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_NARRATION_CHARS);
}

/**
 * A whole number in English words. British form, so 642 is "six hundred and
 * forty-two" rather than "six hundred forty-two".
 *
 * Anything outside 0–9999 is left as digits: the story's numbers are all
 * small, and a silent wrong answer is worse than a spoken numeral.
 */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const rest = n % 10;
    return rest ? `${tens}-${ONES[rest]}` : tens;
  }
  if (n < 1000) {
    const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
    const rest = n % 100;
    return rest ? `${hundreds} and ${numberToWords(rest)}` : hundreds;
  }
  const thousands = `${numberToWords(Math.floor(n / 1000))} thousand`;
  const rest = n % 1000;
  if (!rest) return thousands;
  return rest < 100 ? `${thousands} and ${numberToWords(rest)}` : `${thousands} ${numberToWords(rest)}`;
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Longest first, so `mm` is not eaten by `m`, and `kg` not by `g`. */
const UNITS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\d)\s*mm\b/g, "$1 millimetres"],
  [/(\d)\s*cm\b/g, "$1 centimetres"],
  [/(\d)\s*km\b/g, "$1 kilometres"],
  [/(\d)\s*ml\b/g, "$1 millilitres"],
  [/(\d)\s*kg\b/g, "$1 kilograms"],
  [/(\d)\s*m\b/g, "$1 metres"],
  [/(\d)\s*g\b/g, "$1 grams"],
  [/(\d)\s*l\b/g, "$1 litres"],
];

/**
 * Operators, but only where one genuinely sits between two numbers (or a
 * number and the unknown). The guard is the whole trick: a bare replacement
 * of "-" would turn "check-in" into "check minus in", and prose is the
 * majority of what Tumi says.
 */
const OPERATORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\d|\?)\s*\+\s*(?=\d|\?)/g, "$1 plus "],
  [/(\d|\?)\s*[−–—-]\s*(?=\d|\?)/g, "$1 minus "],
  [/(\d|\?)\s*[×x*]\s*(?=\d|\?)/g, "$1 times "],
  [/(\d|\?)\s*[÷\/]\s*(?=\d|\?)/g, "$1 divided by "],
  [/(\d|\?)\s*=\s*(?=\d|\?)/g, "$1 equals "],
];

/**
 * One line of narration as it should be *spoken*, which is not the same
 * thing as how it is written.
 *
 * The child still reads "3 × 7 = ?" on screen. The voice is sent "three
 * times seven equals what?", and the reason is not politeness: the school's
 * voice runs on ElevenLabs' multilingual model, which infers the language
 * from the text it is given. Fourteen of the maths narrations contain no
 * letter at all, so there was no English in them to detect and the model
 * guessed — which is why the numbers came out of the speaker in another
 * language while every sentence around them was fine.
 *
 * Pinning a language was the other way to fix it, and it was rejected: the
 * multilingual model does not accept `language_code`, so it would have meant
 * a different model and a different voice from the one the school has
 * already heard. Giving the line some English is both cheaper and better —
 * a five-year-old is read to, not shown arithmetic notation.
 *
 * Identity for prose, which is what keeps every existing recording valid:
 * the cache key is built from this string, so a line with no digit and no
 * operator hashes exactly as it did before.
 *
 * Pure. Unit tested.
 */
export function spokenNarration(text: string): string {
  const source = normaliseNarration(text);
  if (!source) return source;

  let out = source;
  for (const [pattern, replacement] of UNITS) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of OPERATORS) out = out.replace(pattern, replacement);

  // "?" is the unknown in an equation and ordinary punctuation everywhere
  // else. `=` is what tells them apart, and it is a clean split in practice:
  // every letterless equation in the story has one, and no sentence does.
  if (source.includes("=")) {
    out = out.replace(/\?/g, "what");
    if (source.includes("?") && !/[.?!]$/.test(out.trim())) out = `${out.trim()}?`;
  }

  out = out.replace(/\d+/g, (digits) => numberToWords(Number(digits)));
  return out.replace(/\s+/g, " ").trim().slice(0, MAX_NARRATION_CHARS);
}

/** The lines the player says that are not in any chapter, so they can be recorded ahead too. */
export const STOCK_LINES: readonly string[] = [
  "Well done! You're a great helper.",
  "Wonderful! Let's keep going.",
  "You did it! Thank you.",
  "Brilliant! Off we go.",
  "Thank you, my friend. You were a wonderful helper. Goodbye!",
];
