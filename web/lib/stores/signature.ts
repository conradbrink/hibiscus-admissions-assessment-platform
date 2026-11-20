/**
 * An employee's drawn signature, for Stores.
 *
 * The same idea as `lib/registration/signature.ts` (strokes of numbers,
 * validated, rendered to SVG by the server from the numbers alone) with one
 * difference: the drawing carries its own box. A pad on a phone held upright
 * is tall and narrow, a pad on a laptop is wide and short, and a fixed box
 * would either cramp the phone or squash the signature when it is shown
 * again. So the pad reports `{ w, h, strokes }` with `w` fixed at 600 and `h`
 * in proportion to the pad, and the replay uses the same box.
 *
 * `stores_signature_ok()` in the database applies the same limits, so a
 * request that skips this file is refused there as well. Pure; unit tested.
 */

export type Point = [number, number];
export type Stroke = Point[];
export type Drawing = { w: number; h: number; strokes: Stroke[] };

/** The width every pad reports in. The height follows the pad's shape. */
export const DRAWING_WIDTH = 600;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 1200;
const MAX_STROKES = 200;
const MAX_POINTS = 6000;

export type DrawingResult = { ok: true; drawing: Drawing } | { ok: false; reason: "empty" | "malformed" | "too_small" };

function isPoint(p: unknown): p is Point {
  return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** The box height for a pad of this shape on screen. */
export function drawingHeight(cssWidth: number, cssHeight: number): number {
  if (!(cssWidth > 0) || !(cssHeight > 0)) return 200;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round((DRAWING_WIDTH * cssHeight) / cssWidth)));
}

/** Total length drawn, in box units. */
export function inkLength(strokes: readonly Stroke[]): number {
  let total = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i += 1) total += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  }
  return total;
}

/** The ink a mark needs to count as a signature rather than a tap. */
export function minimumInk(w: number): number {
  return (w * 80) / 600;
}

/**
 * Parse and check what the browser sent. Unlike the parent pad, a point
 * outside the box is refused rather than clamped: the database refuses it
 * too, and the two must agree on what a signature is.
 */
export function parseDrawing(raw: string | null | undefined): DrawingResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "empty" };
  if (raw.length > 300_000) return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "malformed" };
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length !== 3 || typeof obj.w !== "number" || typeof obj.h !== "number" || !Array.isArray(obj.strokes)) {
    return { ok: false, reason: "malformed" };
  }
  const { w, h } = obj;
  if (w < 200 || w > 1200 || h < MIN_HEIGHT || h > MAX_HEIGHT) return { ok: false, reason: "malformed" };
  if (obj.strokes.length === 0) return { ok: false, reason: "empty" };
  if (obj.strokes.length > MAX_STROKES) return { ok: false, reason: "malformed" };
  const strokes: Stroke[] = [];
  let points = 0;
  for (const s of obj.strokes) {
    if (!Array.isArray(s) || s.length === 0) return { ok: false, reason: "malformed" };
    const stroke: Stroke = [];
    for (const p of s) {
      if (!isPoint(p)) return { ok: false, reason: "malformed" };
      if (p[0] < 0 || p[0] > w || p[1] < 0 || p[1] > h) return { ok: false, reason: "malformed" };
      points += 1;
      if (points > MAX_POINTS) return { ok: false, reason: "malformed" };
      stroke.push([round1(p[0]), round1(p[1])]);
    }
    strokes.push(stroke);
  }
  if (inkLength(strokes) < minimumInk(w)) return { ok: false, reason: "too_small" };
  return { ok: true, drawing: { w, h, strokes } };
}

/** What to tell the person when a drawing is refused. */
export function drawingProblem(reason: "empty" | "malformed" | "too_small"): string {
  if (reason === "too_small") return "That signature is too small. Please sign again, using more of the box.";
  if (reason === "empty") return "The employee must sign before this can be completed.";
  return "The signature could not be read. Clear it and sign again.";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A drawing read back from the database, or null when it is not one. */
export function asDrawing(value: unknown): Drawing | null {
  if (!value || typeof value !== "object") return null;
  const result = parseDrawing(JSON.stringify(value));
  return result.ok ? result.drawing : null;
}

/** The SVG, built from numbers only, never from anything the browser sent as markup. */
export function drawingSvg(d: Drawing): string {
  const path = d.strokes
    .map((s) => {
      // A single point is a dot: a zero-length line with round caps still draws.
      const pts = s.length === 1 ? [s[0], s[0]] : s;
      return pts.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p[0])} ${fmt(p[1])}`).join(" ");
    })
    .join(" ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(d.w)} ${fmt(d.h)}" width="${fmt(d.w)}" height="${fmt(d.h)}">` +
    `<path d="${path}" fill="none" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** A data URL for an <img>, so the SVG is shown as a picture and never inlined as markup. */
export function drawingDataUrl(d: Drawing): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawingSvg(d))}`;
}
