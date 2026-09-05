/**
 * The drawn signature.
 *
 * The browser sends the strokes the parent drew as JSON: an array of
 * strokes, each an array of [x, y] points in a fixed 600 × 200 box. The
 * server validates the shape and the amount of ink, then renders the SVG
 * itself from the numbers alone, so nothing the browser sent is stored as
 * markup. Pure; unit tested.
 */

export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
const MAX_STROKES = 200;
const MAX_POINTS = 4000;
/** Enough ink to be a mark rather than a tap: total path length in box units. */
const MIN_INK = 80;

export type Point = [number, number];
export type Stroke = Point[];

export type SignatureResult = { ok: true; strokes: Stroke[] } | { ok: false; reason: "empty" | "malformed" | "too_small" };

function isPoint(p: unknown): p is Point {
  return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Parse and validate what the browser sent. Points outside the box are clamped; a drawing with no ink is refused. */
export function parseSignature(raw: string | null | undefined): SignatureResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "empty" };
  if (raw.length > 200_000) return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_STROKES) return { ok: false, reason: "malformed" };
  const strokes: Stroke[] = [];
  let points = 0;
  for (const s of parsed) {
    if (!Array.isArray(s)) return { ok: false, reason: "malformed" };
    const stroke: Stroke = [];
    for (const p of s) {
      if (!isPoint(p)) return { ok: false, reason: "malformed" };
      points += 1;
      if (points > MAX_POINTS) return { ok: false, reason: "malformed" };
      stroke.push([clamp(p[0], SIGNATURE_WIDTH), clamp(p[1], SIGNATURE_HEIGHT)]);
    }
    if (stroke.length) strokes.push(stroke);
  }
  if (!strokes.length) return { ok: false, reason: "empty" };
  if (inkLength(strokes) < MIN_INK) return { ok: false, reason: "too_small" };
  return { ok: true, strokes };
}

function clamp(n: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(n * 10) / 10));
}

/** Total length drawn, in box units. */
export function inkLength(strokes: Stroke[]): number {
  let total = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i += 1) {
      const dx = s[i][0] - s[i - 1][0];
      const dy = s[i][1] - s[i - 1][1];
      total += Math.hypot(dx, dy);
    }
  }
  return total;
}

/** The SVG stored with the acceptance: built from numbers only. */
export function signatureSvg(strokes: Stroke[]): string {
  const d = strokes
    .map((s) => {
      // A single point is a dot: a zero-length line with round caps still draws.
      const pts = s.length === 1 ? [s[0], s[0]] : s;
      return pts.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p[0])} ${fmt(p[1])}`).join(" ");
    })
    .join(" ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}" width="${SIGNATURE_WIDTH}" height="${SIGNATURE_HEIGHT}">` +
    `<path d="${d}" fill="none" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A data URL for an <img>, so the stored SVG is never inlined as markup. */
export function signatureDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
