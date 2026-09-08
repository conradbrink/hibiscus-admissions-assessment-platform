"use client";

import type { Backdrop } from "@/lib/assessment/story";

/**
 * The drawn worlds behind a scene. Each is one SVG that fills its box
 * (preserveAspectRatio slices, so nothing stretches): sky, a sun, the
 * ground for that place, and a couple of things that move slowly so the
 * picture feels alive without pulling the eye from the question.
 */
export function SceneBackdrop({ backdrop }: { backdrop: Backdrop }) {
  return (
    <svg viewBox="0 0 960 400" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="sb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sky-top)" />
          <stop offset="1" stopColor="var(--sky-bottom)" />
        </linearGradient>
        <linearGradient id="sb-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--water)" />
          <stop offset="1" stopColor="var(--water-dark)" />
        </linearGradient>
      </defs>
      <rect width="960" height="400" fill="url(#sb-sky)" />
      <Sun />
      <Clouds />
      {backdrop === "river" ? <River /> : null}
      {backdrop === "path" ? <Path /> : null}
      {backdrop === "market" ? <Market /> : null}
      {backdrop === "village" ? <Village /> : null}
      {backdrop === "hill" ? <Hill /> : null}
      {backdrop === "home" ? <Home /> : null}
      {backdrop === "letter" ? <Letter /> : null}
    </svg>
  );
}

function Sun() {
  return (
    <g>
      <circle cx="840" cy="70" r="56" fill="var(--sun)" opacity="0.35" />
      <circle cx="840" cy="70" r="38" fill="var(--sun)" />
    </g>
  );
}

function Cloud({ x, y, s = 1, slow = false }: { x: number; y: number; s?: number; slow?: boolean }) {
  return (
    <g className={slow ? "story-cloud is-slow" : "story-cloud"} transform={`translate(${x} ${y}) scale(${s})`} fill="#fff" opacity="0.9">
      <ellipse cx="0" cy="0" rx="42" ry="18" />
      <circle cx="-16" cy="-10" r="18" />
      <circle cx="12" cy="-14" r="22" />
      <circle cx="32" cy="-4" r="14" />
    </g>
  );
}

function Clouds() {
  return (
    <g>
      <Cloud x={180} y={70} />
      <Cloud x={520} y={46} s={0.8} slow />
      <Cloud x={720} y={110} s={0.6} />
    </g>
  );
}

function Hills({ far = "#a9dd8a", near = "var(--grass)" }: { far?: string; near?: string }) {
  return (
    <g>
      <path d="M0 250 C 160 180, 300 190, 480 240 C 640 280, 800 200, 960 240 L 960 400 L 0 400 Z" fill={far} />
      <path d="M0 300 C 200 250, 360 300, 560 290 C 760 280, 860 260, 960 300 L 960 400 L 0 400 Z" fill={near} />
    </g>
  );
}

function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-8" y="0" width="16" height="60" rx="6" fill="#8b5a2b" />
      <circle cx="0" cy="-20" r="44" fill="#4f9d37" />
      <circle cx="-30" cy="0" r="30" fill="#5faa47" />
      <circle cx="30" cy="0" r="30" fill="#5faa47" />
    </g>
  );
}

function Grass() {
  return (
    <g stroke="var(--grass-dark)" strokeWidth="4" strokeLinecap="round" fill="none">
      <path d="M60 372 q 6 -22 14 -34 M74 372 q 2 -18 12 -28 M90 372 q -4 -20 6 -30" />
      <path d="M620 380 q 6 -22 14 -34 M634 380 q 2 -18 12 -28" />
      <path d="M880 376 q 6 -22 14 -34 M894 376 q 2 -18 12 -28" />
    </g>
  );
}

function River() {
  return (
    <g>
      <Hills />
      <Tree x={120} y={250} />
      <Tree x={860} y={270} s={0.8} />
      <path d="M0 330 C 240 310, 400 360, 960 330 L 960 400 L 0 400 Z" fill="url(#sb-water)" />
      <g className="story-ripple" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.7" fill="none">
        <path d="M120 352 q 20 -8 40 0 M220 366 q 20 -8 40 0 M420 350 q 20 -8 40 0 M640 362 q 20 -8 40 0 M840 350 q 20 -8 40 0 M1000 366 q 20 -8 40 0" />
      </g>
      <Grass />
    </g>
  );
}

function Path() {
  return (
    <g>
      <Hills />
      <Tree x={90} y={260} s={0.9} />
      <Tree x={880} y={250} />
      <path d="M380 400 C 420 340, 520 330, 560 290 C 600 250, 700 250, 760 236" stroke="var(--earth)" strokeWidth="46" strokeLinecap="round" fill="none" />
      <path d="M380 400 C 420 340, 520 330, 560 290 C 600 250, 700 250, 760 236" stroke="#e8c48f" strokeWidth="30" strokeLinecap="round" fill="none" strokeDasharray="2 26" />
    </g>
  );
}

function Stall({ x, colour }: { x: number; colour: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="0" y="260" width="180" height="90" fill="#c98f5a" />
      <rect x="-10" y="226" width="200" height="40" fill={colour} />
      <path d="M-10 266 l20 16 l20 -16 l20 16 l20 -16 l20 16 l20 -16 l20 16 l20 -16 l20 16 l20 -16 l20 16 v-40 h-200 z" fill={colour} />
      <rect x="6" y="226" width="8" height="130" fill="#8b5a2b" />
      <rect x="166" y="226" width="8" height="130" fill="#8b5a2b" />
    </g>
  );
}

function Market() {
  return (
    <g>
      <Hills far="#c9e9b0" />
      <rect x="0" y="350" width="960" height="50" fill="var(--earth)" />
      <Stall x={60} colour="#ff8a5b" />
      <Stall x={400} colour="#63b6ff" />
      <Stall x={740} colour="#ffd166" />
      <g className="story-bob">
        <path d="M0 200 L 960 200" stroke="#8b5a2b" strokeWidth="3" />
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d={`M${i * 60 + 10} 200 l 20 26 l 20 -26 z`} fill={["#ff8a5b", "#ffd166", "#63b6ff", "#a3e635"][i % 4]} />
        ))}
      </g>
    </g>
  );
}

function House({ x, y, s = 1, wall = "#f4e1b5", roof = "#c9743c" }: { x: number; y: number; s?: number; wall?: string; roof?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-60" y="-40" width="120" height="90" rx="8" fill={wall} />
      <path d="M-72 -36 L 0 -100 L 72 -36 Z" fill={roof} />
      <rect x="-16" y="6" width="32" height="44" rx="4" fill="#6b4a2b" />
      <rect x="24" y="-20" width="24" height="24" rx="4" fill="#bfe6ff" />
      <rect x="-48" y="-20" width="24" height="24" rx="4" fill="#bfe6ff" />
    </g>
  );
}

function Village() {
  return (
    <g>
      <Hills />
      <House x={160} y={300} />
      <House x={330} y={310} s={0.8} wall="#ffe0c2" roof="#a85c3b" />
      <House x={800} y={300} s={0.9} wall="#e8f4d6" />
      <Tree x={520} y={250} s={1.1} />
      <rect x="0" y="360" width="960" height="40" fill="var(--earth)" opacity="0.6" />
    </g>
  );
}

function Hill() {
  return (
    <g>
      <path d="M0 400 C 200 280, 320 120, 520 110 C 720 100, 860 260, 960 400 Z" fill="#a9dd8a" />
      <path d="M0 400 C 240 330, 380 220, 560 200 C 740 180, 860 300, 960 400 Z" fill="var(--grass)" />
      <path d="M440 400 C 470 330, 500 260, 540 200" stroke="var(--earth)" strokeWidth="26" strokeLinecap="round" fill="none" />
      <Tree x={200} y={330} s={0.8} />
      <Tree x={760} y={340} s={0.7} />
      <g fill="#9aa3ad">
        <circle cx="340" cy="372" r="14" />
        <circle cx="600" cy="366" r="12" />
        <circle cx="640" cy="380" r="9" />
      </g>
    </g>
  );
}

function Home() {
  return (
    <g>
      <Hills />
      <Tree x={700} y={220} s={1.4} />
      <g transform="translate(300 320)">
        <ellipse cx="0" cy="0" rx="120" ry="60" fill="#f4e1b5" />
        <path d="M-130 -10 C -100 -120, 100 -120, 130 -10 Z" fill="#c9743c" />
        <rect x="-22" y="-30" width="44" height="60" rx="20" fill="#6b4a2b" />
      </g>
      <Grass />
    </g>
  );
}

function Letter() {
  return (
    <g>
      <Hills far="#c9e9b0" />
      <rect x="0" y="340" width="960" height="60" fill="#d9c7a3" />
      <rect x="120" y="180" width="720" height="180" rx="10" fill="#8b5a2b" />
      <rect x="140" y="196" width="680" height="150" rx="6" fill="#a0693a" />
    </g>
  );
}
