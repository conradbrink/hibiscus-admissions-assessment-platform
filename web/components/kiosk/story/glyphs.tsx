"use client";

import type { ReactNode } from "react";

/**
 * Small drawings, each in a 100×100 box, used by the prop library. Simple
 * shapes with a friendly outline, so a four-year-old recognises an apple
 * at a glance and nothing needs a picture file.
 */

const INK = "#2b2d42";

export type GlyphName = keyof typeof GLYPHS;

const OUTLINE = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

export const GLYPHS = {
  apple: (
    <g {...OUTLINE}>
      <path d="M50 30 C 30 14, 8 34, 14 58 C 18 76, 34 92, 50 86 C 66 92, 82 76, 86 58 C 92 34, 70 14, 50 30 Z" fill="#e63946" />
      <path d="M50 30 c 0 -12, 6 -18, 12 -20" fill="none" />
      <path d="M52 22 c 10 -10, 22 -6, 24 2 c -10 4, -18 4, -24 -2 z" fill="#4f9d37" />
    </g>
  ),
  banana: (
    <g {...OUTLINE}>
      <path d="M18 34 C 30 70, 60 88, 88 74 C 84 82, 78 86, 70 88 C 40 92, 12 66, 12 36 Z" fill="#ffd166" />
      <path d="M18 34 l -4 -6 l 6 -2" fill="#8b5a2b" />
    </g>
  ),
  orange: (
    <g {...OUTLINE}>
      <circle cx="50" cy="56" r="34" fill="#ff8a1e" />
      <path d="M50 22 c 4 -10, 14 -12, 20 -6 c -8 6, -14 8, -20 6 z" fill="#4f9d37" />
    </g>
  ),
  cup: (
    <g {...OUTLINE}>
      <path d="M22 30 h 50 l -6 56 h -38 z" fill="#63b6ff" />
      <path d="M72 40 c 16 0, 18 26, 0 30" fill="none" />
      <path d="M22 30 h 50" />
    </g>
  ),
  hat: (
    <g {...OUTLINE}>
      <ellipse cx="50" cy="70" rx="42" ry="12" fill="#ffd166" />
      <path d="M28 70 c 0 -30, 8 -48, 22 -48 c 14 0, 22 18, 22 48 z" fill="#ffd166" />
      <path d="M28 60 c 14 6, 30 6, 44 0" stroke="#e63946" strokeWidth="6" fill="none" />
    </g>
  ),
  book: (
    <g {...OUTLINE}>
      <rect x="22" y="18" width="56" height="66" rx="4" fill="#4a7bd1" />
      <rect x="30" y="18" width="48" height="66" fill="#6b9ae8" stroke="none" />
      <path d="M40 34 h 28 M40 46 h 28 M40 58 h 18" stroke="#fff" />
    </g>
  ),
  blanket: (
    <g {...OUTLINE}>
      <path d="M8 40 L 92 40 L 84 84 L 16 84 Z" fill="#ff8a5b" />
      <path d="M22 40 l 6 44 M40 40 l 4 44 M60 40 l -4 44 M78 40 l -6 44" stroke="#fff" opacity="0.7" />
      <path d="M12 62 h 76" stroke="#fff" opacity="0.7" />
    </g>
  ),
  snake: (
    <g {...OUTLINE}>
      <path d="M14 70 c 0 -20, 24 -20, 24 -4 s 24 16, 24 -4 s 22 -16, 26 4" fill="none" stroke="#5faa47" strokeWidth="14" />
      <circle cx="86" cy="70" r="10" fill="#5faa47" />
      <circle cx="90" cy="68" r="2" fill={INK} stroke="none" />
      <path d="M96 72 l 8 2 l -6 3" stroke="#e63946" />
    </g>
  ),
  sun: (
    <g {...OUTLINE}>
      <circle cx="50" cy="50" r="24" fill="#ffd166" />
      <path d="M50 8 v 12 M50 80 v 12 M8 50 h 12 M80 50 h 12 M20 20 l 8 8 M72 72 l 8 8 M80 20 l -8 8 M28 72 l -8 8" />
    </g>
  ),
  moon: (
    <g {...OUTLINE}>
      <path d="M62 12 C 30 20, 22 64, 50 84 C 66 94, 84 86, 90 76 C 60 80, 42 48, 62 12 Z" fill="#fff3b0" />
    </g>
  ),
  frog: (
    <g {...OUTLINE}>
      <ellipse cx="50" cy="62" rx="36" ry="24" fill="#6cc24a" />
      <circle cx="34" cy="36" r="12" fill="#6cc24a" />
      <circle cx="66" cy="36" r="12" fill="#6cc24a" />
      <circle cx="34" cy="36" r="5" fill="#fff" stroke="none" />
      <circle cx="66" cy="36" r="5" fill="#fff" stroke="none" />
      <circle cx="35" cy="36" r="2.5" fill={INK} stroke="none" />
      <circle cx="67" cy="36" r="2.5" fill={INK} stroke="none" />
      <path d="M36 66 q 14 10 28 0" fill="none" />
    </g>
  ),
  boat: (
    <g {...OUTLINE}>
      <path d="M10 62 h 80 l -14 22 h -52 z" fill="#c9743c" />
      <path d="M50 14 v 48 M50 20 l 30 30 h -30 z" fill="#fff" />
    </g>
  ),
  goat: (
    <g {...OUTLINE}>
      <ellipse cx="46" cy="62" rx="30" ry="18" fill="#f1f1f1" />
      <path d="M72 46 c 12 -12, 20 -6, 22 8 c 0 12, -10 16, -20 10 z" fill="#f1f1f1" />
      <path d="M84 44 l 6 -14 M90 46 l 8 -10" />
      <path d="M28 78 v 12 M40 80 v 10 M54 80 v 10 M66 76 v 12" />
      <circle cx="86" cy="52" r="2" fill={INK} stroke="none" />
      <path d="M94 60 l 0 8" />
    </g>
  ),
  crocodile: (
    <g {...OUTLINE}>
      <path d="M6 60 c 10 -16, 40 -20, 70 -14 l 20 10 l -22 8 c -30 6, -60 2, -68 -4 z" fill="#5faa47" />
      <path d="M60 52 l 4 6 l 4 -6 l 4 6 l 4 -6 l 4 6" fill="none" stroke="#fff" />
      <circle cx="56" cy="46" r="4" fill="#fff" />
      <circle cx="57" cy="46" r="1.5" fill={INK} stroke="none" />
      <path d="M20 66 v 8 M40 68 v 8" />
    </g>
  ),
  ball: (
    <g {...OUTLINE}>
      <circle cx="50" cy="56" r="30" fill="#e63946" />
      <path d="M22 44 c 20 8, 36 8, 56 0 M22 68 c 20 -8, 36 -8, 56 0" fill="none" stroke="#fff" />
    </g>
  ),
  bird: (
    <g {...OUTLINE}>
      <ellipse cx="50" cy="58" rx="26" ry="18" fill="#63b6ff" />
      <circle cx="70" cy="42" r="13" fill="#63b6ff" />
      <path d="M82 42 l 12 4 l -12 4 z" fill="#ffd166" />
      <circle cx="73" cy="40" r="2" fill={INK} stroke="none" />
      <path d="M30 56 c -10 -12, -2 -24, 12 -20" fill="#4a90d9" />
      <path d="M24 64 l -14 6 l 14 2" fill="#63b6ff" />
    </g>
  ),
  fish: (
    <g {...OUTLINE}>
      <path d="M14 50 c 20 -26, 50 -26, 70 0 c -20 26, -50 26, -70 0 z" fill="#ff8a5b" />
      <path d="M84 50 l 12 -14 v 28 z" fill="#ff8a5b" />
      <circle cx="30" cy="46" r="3" fill={INK} stroke="none" />
    </g>
  ),
  shell: (
    <g {...OUTLINE}>
      <path d="M50 84 L 14 44 C 26 14, 74 14, 86 44 Z" fill="#ffd9c2" />
      <path d="M50 84 L 30 40 M50 84 L 50 30 M50 84 L 70 40" />
    </g>
  ),
  bell: (
    <g {...OUTLINE}>
      <path d="M50 14 c -20 0, -26 18, -26 40 l -10 14 h 72 l -10 -14 c 0 -22, -6 -40, -26 -40 z" fill="#ffd166" />
      <circle cx="50" cy="80" r="8" fill="#e6b400" />
    </g>
  ),
  bus: (
    <g {...OUTLINE}>
      <rect x="8" y="28" width="84" height="46" rx="8" fill="#ffd166" />
      <rect x="16" y="36" width="18" height="16" fill="#bfe6ff" />
      <rect x="42" y="36" width="18" height="16" fill="#bfe6ff" />
      <rect x="68" y="36" width="16" height="16" fill="#bfe6ff" />
      <circle cx="26" cy="78" r="8" fill={INK} />
      <circle cx="74" cy="78" r="8" fill={INK} />
    </g>
  ),
  hen: (
    <g {...OUTLINE}>
      <ellipse cx="46" cy="60" rx="28" ry="20" fill="#f4e1b5" />
      <circle cx="70" cy="40" r="12" fill="#f4e1b5" />
      <path d="M66 26 q 4 -10 8 0 q 4 -10 8 0" fill="#e63946" />
      <path d="M82 42 l 10 3 l -10 3 z" fill="#ff8a1e" />
      <circle cx="72" cy="38" r="2" fill={INK} stroke="none" />
      <path d="M36 80 v 10 M52 80 v 10" />
    </g>
  ),
  tin: (
    <g {...OUTLINE}>
      <rect x="28" y="24" width="44" height="56" rx="4" fill="#9fb3c8" />
      <ellipse cx="50" cy="24" rx="22" ry="6" fill="#c9d6e2" />
      <rect x="28" y="44" width="44" height="18" fill="#e63946" stroke="none" />
    </g>
  ),
  bottle: (
    <g {...OUTLINE}>
      <path d="M40 10 h 20 v 16 c 10 6, 12 12, 12 24 v 36 a 4 4 0 0 1 -4 4 h -36 a 4 4 0 0 1 -4 -4 v -36 c 0 -12, 2 -18, 12 -24 z" fill="#8fd3f4" />
      <rect x="34" y="52" width="32" height="18" fill="#fff" stroke="none" />
    </g>
  ),
  sweet: (
    <g {...OUTLINE}>
      <ellipse cx="50" cy="50" rx="20" ry="16" fill="#ff5c8a" />
      <path d="M30 50 l -16 -12 v 24 z M70 50 l 16 -12 v 24 z" fill="#ff5c8a" />
      <path d="M42 42 q 8 8 16 0" fill="none" stroke="#fff" />
    </g>
  ),
  coin: (
    <g {...OUTLINE}>
      <circle cx="50" cy="50" r="30" fill="#ffd166" />
      <circle cx="50" cy="50" r="22" fill="none" stroke="#e6b400" />
    </g>
  ),
  stone: (
    <g {...OUTLINE}>
      <path d="M22 66 c -10 -20, 10 -40, 34 -38 c 24 2, 34 24, 24 40 c -10 12, -50 14, -58 -2 z" fill="#9aa3ad" />
    </g>
  ),
  stick: (
    <g {...OUTLINE}>
      <path d="M14 82 L 84 18" stroke="#8b5a2b" strokeWidth="10" />
    </g>
  ),
  chair: (
    <g {...OUTLINE}>
      <rect x="24" y="14" width="10" height="72" fill="#c9743c" />
      <rect x="24" y="50" width="52" height="10" fill="#c9743c" />
      <rect x="66" y="52" width="10" height="34" fill="#c9743c" />
      <rect x="24" y="14" width="40" height="10" fill="#c9743c" />
    </g>
  ),
  ship: (
    <g {...OUTLINE}>
      <path d="M6 64 h 88 l -16 22 h -56 z" fill="#4a7bd1" />
      <rect x="30" y="40" width="40" height="24" fill="#f1f1f1" />
      <rect x="44" y="20" width="12" height="20" fill="#e63946" />
    </g>
  ),
  cone: (
    <g {...OUTLINE}>
      <path d="M50 10 L 86 78 C 66 92, 34 92, 14 78 Z" fill="#ff8a5b" />
      <ellipse cx="50" cy="78" rx="36" ry="10" fill="#e06a3b" />
    </g>
  ),
  cube: (
    <g {...OUTLINE}>
      <path d="M22 34 L 54 20 L 86 34 L 54 48 Z" fill="#bfe6ff" />
      <path d="M22 34 L 54 48 V 84 L 22 70 Z" fill="#63b6ff" />
      <path d="M54 48 L 86 34 V 70 L 54 84 Z" fill="#4a90d9" />
    </g>
  ),
  ladder: (
    <g {...OUTLINE}>
      <path d="M32 8 v 84 M68 8 v 84" stroke="#8b5a2b" strokeWidth="6" />
      <path d="M32 22 h 36 M32 40 h 36 M32 58 h 36 M32 76 h 36" stroke="#8b5a2b" strokeWidth="5" />
    </g>
  ),
  plate: (
    <g {...OUTLINE}>
      <ellipse cx="50" cy="56" rx="42" ry="20" fill="#f1f1f1" />
      <ellipse cx="50" cy="56" rx="26" ry="11" fill="#e2e2e2" />
    </g>
  ),
  hand: (
    <g {...OUTLINE}>
      <path d="M30 90 v -36 a 6 6 0 0 1 12 0 v -24 a 6 6 0 0 1 12 0 v 20 a 6 6 0 0 1 12 0 v 8 a 6 6 0 0 1 12 0 v 18 c 0 16, -12 24, -24 24 h -8 c -10 0, -16 -6, -16 -10 z" fill="#f4c7a1" />
      <path d="M30 60 l -10 -8 a 5 5 0 0 1 8 -6 l 8 8" fill="#f4c7a1" />
    </g>
  ),
  crate: (
    <g {...OUTLINE}>
      <rect x="10" y="36" width="80" height="50" rx="4" fill="#c9743c" />
      <path d="M10 52 h 80 M10 70 h 80" />
      {Array.from({ length: 10 }, (_, i) => (
        <circle key={i} cx={20 + (i % 5) * 15} cy={i < 5 ? 30 : 18} r="7" fill="#ff8a1e" />
      ))}
    </g>
  ),
  basket: (
    <g {...OUTLINE}>
      <path d="M12 44 h 76 l -8 44 h -60 z" fill="#d9a066" />
      <path d="M12 44 c 14 -30, 62 -30, 76 0" fill="none" />
      <path d="M22 58 h 56 M20 72 h 60" stroke="#8b5a2b" />
    </g>
  ),
  tree: (
    <g {...OUTLINE}>
      <rect x="44" y="60" width="12" height="32" fill="#8b5a2b" />
      <circle cx="50" cy="44" r="28" fill="#4f9d37" />
      <circle cx="30" cy="56" r="16" fill="#5faa47" />
      <circle cx="70" cy="56" r="16" fill="#5faa47" />
    </g>
  ),
  feather: (
    <g {...OUTLINE}>
      <path d="M22 84 C 30 40, 56 16, 84 14 C 80 46, 58 72, 22 84 Z" fill="#bfe6ff" />
      <path d="M22 84 L 70 30" />
    </g>
  ),
  grass: (
    <g {...OUTLINE}>
      <path d="M20 88 q 4 -30 12 -46 M32 88 q 2 -24 14 -38 M48 88 q -2 -30 6 -50 M62 88 q 4 -24 14 -36 M76 88 q -2 -28 6 -44" stroke="#5faa47" strokeWidth="6" fill="none" />
    </g>
  ),
  nest: (
    <g {...OUTLINE}>
      <ellipse cx="50" cy="60" rx="38" ry="18" fill="#b98c5a" />
      <ellipse cx="50" cy="52" rx="28" ry="10" fill="#8b5a2b" />
      <ellipse cx="40" cy="48" rx="8" ry="10" fill="#fff3b0" />
      <ellipse cx="58" cy="48" rx="8" ry="10" fill="#fff3b0" />
    </g>
  ),
  house: (
    <g {...OUTLINE}>
      <rect x="20" y="46" width="60" height="42" rx="4" fill="#f4e1b5" />
      <path d="M12 48 L 50 14 L 88 48 Z" fill="#c9743c" />
      <rect x="42" y="62" width="16" height="26" fill="#6b4a2b" />
    </g>
  ),
  market: (
    <g {...OUTLINE}>
      <rect x="14" y="50" width="72" height="36" fill="#c98f5a" />
      <path d="M8 34 h 84 v 16 l -8 6 l -8 -6 l -8 6 l -8 -6 l -8 6 l -8 -6 l -8 6 l -8 -6 l -8 6 l -8 -6 l -8 6 z" fill="#ff8a5b" />
      <circle cx="34" cy="60" r="6" fill="#ff8a1e" stroke="none" />
      <circle cx="50" cy="60" r="6" fill="#ff8a1e" stroke="none" />
      <circle cx="66" cy="60" r="6" fill="#ff8a1e" stroke="none" />
    </g>
  ),
  river: (
    <g {...OUTLINE}>
      <path d="M6 40 C 30 30, 50 54, 94 40 V 90 H 6 Z" fill="#63b6ff" />
      <path d="M20 62 q 10 -6 20 0 M54 72 q 10 -6 20 0" fill="none" stroke="#fff" />
    </g>
  ),
  card: (
    <g {...OUTLINE}>
      <rect x="10" y="18" width="80" height="64" rx="6" fill="#fffdf7" />
      <path d="M22 38 h 56 M22 50 h 56 M22 62 h 40" stroke="#c9d6e2" />
    </g>
  ),
  drum: (
    <g {...OUTLINE}>
      <rect x="18" y="34" width="64" height="44" fill="#c9743c" />
      <ellipse cx="50" cy="34" rx="32" ry="10" fill="#f4e1b5" />
      <ellipse cx="50" cy="78" rx="32" ry="10" fill="#a85c3b" />
      <path d="M26 44 l 8 30 M50 44 v 30 M74 44 l -8 30" stroke="#ffd166" />
    </g>
  ),
  child: (
    <g {...OUTLINE}>
      <circle cx="50" cy="30" r="16" fill="#c68642" />
      <path d="M30 90 v -28 a 20 20 0 0 1 40 0 v 28 z" fill="#63b6ff" />
    </g>
  ),
  dot: (
    <g>
      <circle cx="50" cy="50" r="22" fill="#4a7bd1" />
    </g>
  ),
  step: (
    <g {...OUTLINE}>
      <rect x="10" y="40" width="80" height="34" rx="4" fill="#9aa3ad" />
    </g>
  ),
  pie: (
    <g {...OUTLINE}>
      <circle cx="50" cy="50" r="36" fill="#e8a660" />
      <path d="M50 50 L 86 50 A 36 36 0 0 0 50 14 Z" fill="#c9743c" />
    </g>
  ),
} satisfies Record<string, ReactNode>;

/** Which glyph a plural or alias token uses. */
export const GLYPH_ALIASES: Record<string, GlyphName> = {
  apples: "apple",
  oranges: "orange",
  tins: "tin",
  bottles: "bottle",
  sweets: "sweet",
  coins: "coin",
  stones: "stone",
  sticks: "stick",
  plates: "plate",
  hands: "hand",
  crates: "crate",
  baskets: "basket",
  pile: "apple",
  ladders: "ladder",
  feathers: "feather",
  dots: "dot",
  steps: "step",
  children: "child",
  "book-open": "book",
};

export function glyphFor(kind: string): GlyphName | null {
  if (kind in GLYPHS) return kind as GlyphName;
  return GLYPH_ALIASES[kind] ?? null;
}

export function Glyph({ name, size = 72, className, title }: { name: GlyphName; size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {GLYPHS[name]}
    </svg>
  );
}
