"use client";

import type { ReactNode } from "react";
import { parseCount, parseFocus, RAIN_CHART, type Focus } from "@/lib/assessment/story";
import { cn } from "@/lib/utils";
import { Glyph, glyphFor, type GlyphName } from "./glyphs";

/**
 * What the scene shows for one item, from its focus tokens. A token is a
 * kind and an argument ("apples:3", "clock:4:30", "text:…"); the kinds are
 * the vocabulary the chapters use, listed in docs/RUNBOOK.md. A kind
 * nobody drew yet falls back to a labelled card, so a typo in content
 * shows a word instead of nothing.
 */

const INK = "#2b2d42";

export function SceneProps({ focus, big }: { focus: string[]; big?: boolean }) {
  if (focus.length === 0) return null;
  const parsed = focus.map(parseFocus);
  return (
    <div className={cn("flex flex-wrap items-end justify-center gap-4 sm:gap-6", big && "gap-8")}>
      {parsed.map((f, i) => (
        <div key={`${f.kind}-${i}`} className={cn("story-prop story-pop", f.highlight && "story-highlight")} style={{ animationDelay: `${i * 70}ms` }}>
          <Prop focus={f} />
        </div>
      ))}
    </div>
  );
}

function Tile({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-1 rounded-2xl bg-white/85 px-4 py-3 shadow-[0_6px_0_rgba(43,45,66,0.12)]", className)}>
      {children}
      {label ? <span className="text-sm font-semibold text-[color:var(--ink)]/70">{label}</span> : null}
    </div>
  );
}

function BigCard({ text, sub, wide }: { text: string; sub?: string; wide?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border-4 border-[color:var(--ink)]/80 bg-[color:var(--paper)] px-6 py-4 shadow-[0_6px_0_rgba(43,45,66,0.2)]", wide ? "min-w-40" : "min-w-24")}>
      <span className="text-5xl font-bold tabular-nums tracking-wide sm:text-6xl">{text}</span>
      {sub ? <span className="mt-1 text-base font-semibold text-[color:var(--ink)]/70">{sub}</span> : null}
    </div>
  );
}

function Prop({ focus }: { focus: Focus }): ReactNode {
  const { kind, args, raw } = focus;
  switch (kind) {
    case "cards":
    case "card":
      if (args.length === 0) return <WritingCard />;
      return (
        <div className="flex flex-wrap items-center justify-center gap-4">
          {args.map((a, i) => (
            <BigCard key={i} text={a} />
          ))}
        </div>
      );
    case "number":
      return <BigCard text={raw} wide />;
    case "sum":
      return <BigCard text={raw.replace(/\+/g, " + ").replace(/-|−/g, " − ").replace(/x|×/g, " × ").replace(/÷/g, " ÷ ").replace(/=/g, " = ").replace(/\s+/g, " ")} wide />;
    case "letters":
      return (
        <div className="flex flex-wrap gap-3">
          {args.map((a, i) => (
            <LetterTile key={i} text={a} />
          ))}
        </div>
      );
    case "letter":
      return <LetterTile text={raw} big />;
    case "word":
      return <WordSign text={raw} big />;
    case "words":
      return (
        <div className="flex flex-wrap items-center justify-center gap-4">
          {raw.split(",").map((w, i) => (
            <WordSign key={i} text={w.trim()} />
          ))}
        </div>
      );
    case "sentence":
      return <WordSign text={raw} />;
    case "sign":
      return <Signpost text={raw} />;
    case "house-sign":
      return <Signpost picture />;
    case "text":
      return <Passage text={raw} />;
    case "clock":
      return <Clock time={raw} />;
    case "chart":
      return <RainChart />;
    case "fractions":
      return (
        <div className="flex flex-wrap items-end justify-center gap-6">
          {args.map((a, i) => (
            <Fraction key={i} spec={a} index={i} />
          ))}
        </div>
      );
    case "frames":
      return (
        <div className="flex flex-wrap items-center justify-center gap-4">
          {args.map((a, i) => (
            <Frame key={i} what={a} index={i} />
          ))}
        </div>
      );
    case "shapes":
    case "pattern":
    case "colours":
    case "sizes":
      return <ShapeRow kind={kind} args={args} />;
    case "tenframe":
      return <TenFrame filled={Number(args[0] ?? 0)} />;
    case "scales":
      return <Scales left={args[0] ?? "tin"} right={args[1] ?? "feather"} />;
    case "ladders":
      return (
        <div className="flex items-end gap-8">
          {args.map((a, i) => (
            <Tile key={i} label={a === "long" ? "" : ""}>
              <svg viewBox="0 0 40 120" width={44} height={a === "long" ? 150 : 90} preserveAspectRatio="none" aria-hidden>
                <path d="M8 4 v 112 M32 4 v 112" stroke="#8b5a2b" strokeWidth="6" strokeLinecap="round" />
                {[20, 40, 60, 80, 100].map((y) => (
                  <path key={y} d={`M8 ${y} h 24`} stroke="#8b5a2b" strokeWidth="5" strokeLinecap="round" />
                ))}
              </svg>
            </Tile>
          ))}
        </div>
      );
    case "calendar":
      return <WeekStrip />;
    case "twos":
      return <BigCard text="2, 4, 6, __" wide />;
    case "array":
      return <CountedGlyphs glyph="dot" spec={raw} />;
    case "path":
      return <PathSegments parts={args} />;
    case "hill":
      return <HillHeights total={Number(args[0] ?? 0)} climbed={Number(args[1] ?? 0)} />;
    case "ruler":
      return <Ruler length={Number(args[0] ?? 10)} />;
    case "coins":
      return <Purse />;
    case "ball-under":
      return <BallUnder />;
    case "bird-on":
      return <BirdOn />;
    case "book-open":
      return <OpenBook />;
    default: {
      const g = glyphFor(kind);
      if (g) {
        if (args.length === 0) return <Glyph name={g} size={focus.highlight ? 132 : 104} title={kind} />;
        return <CountedGlyphs glyph={g} spec={args[0]} container={kind === "pile" || kind === "basket" ? kind : null} />;
      }
      return (
        <Tile>
          <span className="text-2xl font-bold">{args.length ? `${kind}: ${args.join(", ")}` : kind}</span>
        </Tile>
      );
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Counting                                                                  */
/* ------------------------------------------------------------------------ */

function Row({ glyph, n, size, faded, crossed }: { glyph: GlyphName; n: number; size: number; faded?: boolean; crossed?: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-1" style={{ maxWidth: size * 5 + 40 }}>
      {Array.from({ length: n }, (_, i) => {
        const cross = crossed !== undefined && i >= n - crossed;
        return (
          <span key={i} className={cn("relative inline-flex", faded && "opacity-40")}>
            <Glyph name={glyph} size={size} />
            {cross ? (
              <svg viewBox="0 0 100 100" width={size} height={size} className="absolute inset-0" aria-hidden>
                <path d="M18 18 L 82 82 M82 18 L 18 82" stroke="#e63946" strokeWidth="9" strokeLinecap="round" />
              </svg>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function CountedGlyphs({ glyph, spec, container }: { glyph: GlyphName; spec: string | undefined; container?: "pile" | "basket" | null }) {
  const c = parseCount(spec);
  const size = c.shape === "count" && c.n > 12 ? 44 : c.shape === "array" ? 40 : 64;
  let body: ReactNode;
  switch (c.shape) {
    case "count":
      body = <Row glyph={glyph} n={c.n} size={size} />;
      break;
    case "plus":
      body = (
        <div className="flex items-center gap-3">
          <Row glyph={glyph} n={c.a} size={size} />
          <span className="text-4xl font-bold">+</span>
          <Row glyph={glyph} n={c.b} size={size} />
        </div>
      );
      break;
    case "minus":
      body = <Row glyph={glyph} n={c.a} size={size} crossed={c.b} />;
      break;
    case "array":
      body = (
        <div className="flex items-end gap-4">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${c.cols}, ${size}px)` }}>
            {Array.from({ length: c.rows * c.cols }, (_, i) => (
              <Glyph key={i} name={glyph} size={size} />
            ))}
          </div>
          {c.extra > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold">+</span>
              <Row glyph={glyph} n={c.extra} size={size} />
            </div>
          ) : null}
        </div>
      );
      break;
    default:
      body = <Row glyph={glyph} n={12} size={40} />;
  }
  if (container === "basket") {
    return (
      <div className="flex flex-col items-center">
        <div className="-mb-6 max-w-64">{body}</div>
        <Glyph name="basket" size={140} />
      </div>
    );
  }
  if (container === "pile") {
    return <Tile>{body}</Tile>;
  }
  return <Tile>{body}</Tile>;
}

function TenFrame({ filled }: { filled: number }) {
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl border-4 border-[color:var(--ink)]/80 bg-white p-2">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex size-14 items-center justify-center border-2 border-[color:var(--ink)]/40">
          {i < filled ? <span className="size-9 rounded-full bg-[#4a7bd1]" /> : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Letters and words                                                         */
/* ------------------------------------------------------------------------ */

function LetterTile({ text, big }: { text: string; big?: boolean }) {
  return (
    <div className={cn("flex items-center justify-center rounded-2xl bg-[#ffd166] font-bold shadow-[0_6px_0_#e6b400]", big ? "size-32 text-7xl" : "size-20 text-5xl")}>
      {text}
    </div>
  );
}

function WordSign({ text, big }: { text: string; big?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className={cn("rounded-xl border-4 border-[#8b5a2b] bg-[#f4e1b5] px-6 py-3 font-bold tracking-wide shadow-[0_6px_0_#8b5a2b]", big ? "text-6xl" : "text-3xl sm:text-4xl")}>{text}</div>
      <div className="h-8 w-3 bg-[#8b5a2b]" />
    </div>
  );
}

function Signpost({ text, picture }: { text?: string; picture?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2 rounded-lg bg-[#c9743c] px-5 py-2 text-4xl font-bold tracking-widest text-[#fffdf7] shadow-[0_5px_0_#8b5a2b] [clip-path:polygon(0_0,90%_0,100%_50%,90%_100%,0_100%)]">
        {picture ? <Glyph name="house" size={56} /> : text}
      </div>
      <div className="h-16 w-4 bg-[#8b5a2b]" />
    </div>
  );
}

function Passage({ text }: { text: string }) {
  const paragraphs = text.split(/\n+/);
  return (
    <div className="max-h-[42vh] max-w-2xl overflow-y-auto rounded-2xl border-4 border-[#d9c7a3] bg-[color:var(--paper)] px-6 py-5 text-left shadow-[0_6px_0_rgba(43,45,66,0.15)]">
      {paragraphs.map((p, i) => (
        <p key={i} className="mb-3 text-xl leading-relaxed sm:text-2xl">
          {p}
        </p>
      ))}
    </div>
  );
}

function WritingCard() {
  return (
    <div className="w-80 rounded-2xl border-4 border-[#d9c7a3] bg-[color:var(--paper)] p-5 shadow-[0_6px_0_rgba(43,45,66,0.15)]">
      <div className="space-y-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-0.5 w-full bg-[#c9d6e2]" />
        ))}
      </div>
      <p className="mt-4 text-center text-sm font-semibold text-[color:var(--ink)]/60">Write on paper</p>
    </div>
  );
}

function OpenBook() {
  return (
    <svg viewBox="0 0 200 120" width={260} height={156} aria-label="an open book">
      <path d="M10 20 Q 100 4 100 20 V 110 Q 100 96 10 110 Z" fill="#fffdf7" stroke={INK} strokeWidth="3" />
      <path d="M190 20 Q 100 4 100 20 V 110 Q 100 96 190 110 Z" fill="#fffdf7" stroke={INK} strokeWidth="3" />
      {[36, 50, 64, 78].map((y) => (
        <g key={y} stroke="#9fb3c8" strokeWidth="3" strokeLinecap="round">
          <path d={`M24 ${y} h 62`} />
          <path d={`M114 ${y} h 62`} />
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Scenes inside scenes                                                      */
/* ------------------------------------------------------------------------ */

function BallUnder() {
  return (
    <Tile>
      <svg viewBox="0 0 160 120" width={200} height={150} aria-label="a ball under the blanket">
        <circle cx="80" cy="84" r="28" fill="#e63946" stroke={INK} strokeWidth="3" />
        <path d="M10 60 L 150 60 L 140 100 L 20 100 Z" fill="#ff8a5b" stroke={INK} strokeWidth="3" opacity="0.92" />
      </svg>
    </Tile>
  );
}

function BirdOn() {
  return (
    <Tile>
      <svg viewBox="0 0 160 120" width={200} height={150} aria-label="a bird on the blanket">
        <path d="M10 70 L 150 70 L 140 110 L 20 110 Z" fill="#ff8a5b" stroke={INK} strokeWidth="3" />
        <g transform="translate(40 0) scale(0.8)">
          <ellipse cx="50" cy="58" rx="26" ry="18" fill="#63b6ff" stroke={INK} strokeWidth="3" />
          <circle cx="70" cy="42" r="13" fill="#63b6ff" stroke={INK} strokeWidth="3" />
          <path d="M82 42 l 12 4 l -12 4 z" fill="#ffd166" stroke={INK} strokeWidth="3" />
          <circle cx="73" cy="40" r="2" fill={INK} />
        </g>
      </svg>
    </Tile>
  );
}

const FRAME_PICTURES: Record<string, ReactNode> = {
  river: (
    <>
      <Glyph name="river" size={80} />
      <span className="absolute top-1 right-2">
        <Glyph name="bird" size={40} />
      </span>
    </>
  ),
  market: (
    <>
      <Glyph name="market" size={80} />
      <span className="absolute top-1 right-2">
        <Glyph name="bird" size={40} />
      </span>
    </>
  ),
  tree: (
    <>
      <Glyph name="tree" size={80} />
      <span className="absolute top-2 left-3">
        <Glyph name="nest" size={40} />
      </span>
    </>
  ),
  grass: <Glyph name="grass" size={80} />,
  feathers: (
    <>
      <Glyph name="feather" size={60} />
      <Glyph name="feather" size={60} />
    </>
  ),
  goat: (
    <>
      <Glyph name="tree" size={80} />
      <span className="absolute top-3 left-4">
        <Glyph name="goat" size={44} />
      </span>
    </>
  ),
  nest: (
    <>
      <Glyph name="tree" size={80} />
      <span className="absolute -top-1 left-6">
        <Glyph name="nest" size={44} />
      </span>
    </>
  ),
};

function Frame({ what, index }: { what: string; index: number }) {
  const picture = FRAME_PICTURES[what] ?? <span className="text-xl font-bold">{what}</span>;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex size-32 items-center justify-center rounded-xl border-4 border-[#8b5a2b] bg-[#eef9ff]">{picture}</div>
      <span className="text-sm font-semibold text-[color:var(--ink)]/60">{index + 1}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Shapes                                                                    */
/* ------------------------------------------------------------------------ */

const COLOURS: Record<string, string> = { red: "#e63946", blue: "#4a7bd1", green: "#5faa47", yellow: "#ffd166", orange: "#ff8a1e", purple: "#9b5de5", pink: "#ff5c8a" };

function Shape({ name, size = 88, fill }: { name: string; size?: number; fill?: string }) {
  const colour = fill ?? { circle: "#e63946", square: "#4a7bd1", triangle: "#ffd166", rectangle: "#5faa47" }[name] ?? "#9aa3ad";
  const s = { fill: colour, stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label={name}>
      {name === "circle" ? <circle cx="50" cy="50" r="40" {...s} /> : null}
      {name === "square" ? <rect x="12" y="12" width="76" height="76" rx="6" {...s} /> : null}
      {name === "triangle" ? <path d="M50 10 L 92 88 L 8 88 Z" {...s} /> : null}
      {name === "rectangle" ? <rect x="6" y="26" width="88" height="48" rx="6" {...s} /> : null}
      {name === "?" ? <rect x="12" y="12" width="76" height="76" rx="12" fill="none" stroke={INK} strokeWidth="4" strokeDasharray="10 8" /> : null}
      {name === "?" ? <text x="50" y="66" textAnchor="middle" fontSize="44" fontWeight="700" fill={INK}>?</text> : null}
    </svg>
  );
}

function ShapeRow({ kind, args }: { kind: string; args: string[] }) {
  if (kind === "sizes") {
    const shape = args[0] ?? "square";
    return (
      <div className="flex items-end gap-6">
        <Shape name={shape} size={60} />
        <Shape name={shape} size={120} />
        <Shape name={shape} size={84} />
      </div>
    );
  }
  if (kind === "colours") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {args.map((a, i) => (a === "?" ? <Shape key={i} name="?" size={64} /> : <Shape key={i} name="circle" size={64} fill={COLOURS[a] ?? "#9aa3ad"} />))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-4">
      {args.map((a, i) => (
        <Shape key={i} name={a} size={kind === "pattern" ? 72 : 96} />
      ))}
    </div>
  );
}

function Fraction({ spec, index }: { spec: string; index: number }) {
  const [numRaw, denRaw] = spec.split("/");
  const num = Number(numRaw);
  const den = Number(denRaw);
  const round = index % 2 === 0;
  const parts = Array.from({ length: den }, (_, i) => i);
  return (
    <div className="flex flex-col items-center gap-1">
      {round ? (
        <svg viewBox="0 0 100 100" width={120} height={120} aria-label={`${num} of ${den} shaded`}>
          {parts.map((i) => {
            const a0 = (i / den) * Math.PI * 2 - Math.PI / 2;
            const a1 = ((i + 1) / den) * Math.PI * 2 - Math.PI / 2;
            const large = 1 / den > 0.5 ? 1 : 0;
            const d = `M50 50 L ${50 + 44 * Math.cos(a0)} ${50 + 44 * Math.sin(a0)} A 44 44 0 ${large} 1 ${50 + 44 * Math.cos(a1)} ${50 + 44 * Math.sin(a1)} Z`;
            return <path key={i} d={d} fill={i < num ? "#4a7bd1" : "#fff"} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
          })}
          {den === 1 ? <circle cx="50" cy="50" r="44" fill="#4a7bd1" stroke={INK} strokeWidth="3" /> : null}
        </svg>
      ) : (
        <svg viewBox="0 0 140 70" width={150} height={75} aria-label={`${num} of ${den} shaded`}>
          {parts.map((i) => (
            <rect key={i} x={4 + (i * 132) / den} y="4" width={132 / den} height="62" fill={i < num ? "#4a7bd1" : "#fff"} stroke={INK} strokeWidth="3" />
          ))}
        </svg>
      )}
      <span className="text-sm font-semibold text-[color:var(--ink)]/60">{["first", "second", "third", "fourth"][index] ?? index + 1}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Measures                                                                  */
/* ------------------------------------------------------------------------ */

function Clock({ time }: { time: string }) {
  const [hRaw, mRaw] = time.split(":");
  const h = Number(hRaw) % 12;
  const m = Number(mRaw ?? 0);
  const minuteAngle = (m / 60) * 360;
  const hourAngle = ((h + m / 60) / 12) * 360;
  const hand = (angle: number, len: number, w: number) => {
    const a = ((angle - 90) * Math.PI) / 180;
    return <path d={`M50 50 L ${50 + len * Math.cos(a)} ${50 + len * Math.sin(a)}`} stroke={INK} strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <svg viewBox="0 0 100 100" width={170} height={170} aria-label={`a clock showing ${time}`}>
      <circle cx="50" cy="50" r="46" fill="#fffdf7" stroke={INK} strokeWidth="4" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = ((i * 30 - 90) * Math.PI) / 180;
        return (
          <text key={i} x={50 + 36 * Math.cos(a)} y={50 + 36 * Math.sin(a) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
            {i === 0 ? 12 : i}
          </text>
        );
      })}
      {hand(hourAngle, 20, 5)}
      {hand(minuteAngle, 30, 3.5)}
      <circle cx="50" cy="50" r="3" fill={INK} />
    </svg>
  );
}

function RainChart() {
  const max = 120;
  const w = 60;
  return (
    <div className="rounded-2xl bg-white/90 p-4 shadow-[0_6px_0_rgba(43,45,66,0.12)]">
      <p className="mb-2 text-center text-base font-bold">Rain in Gaborone (mm)</p>
      <svg viewBox="0 0 420 240" width={440} height={250} aria-label="a bar chart of monthly rainfall">
        {[0, 20, 40, 60, 80, 100, 120].map((v) => {
          const y = 200 - (v / max) * 180;
          return (
            <g key={v}>
              <path d={`M40 ${y} H 410`} stroke="#c9d6e2" strokeWidth="1" />
              <text x="34" y={y + 4} textAnchor="end" fontSize="12" fill={INK}>
                {v}
              </text>
            </g>
          );
        })}
        {RAIN_CHART.map((r, i) => {
          const h = (r.mm / max) * 180;
          const x = 50 + i * w;
          return (
            <g key={r.month}>
              <rect x={x} y={200 - h} width={w - 14} height={h} rx="4" fill="#4a7bd1" stroke={INK} strokeWidth="2" />
              <text x={x + (w - 14) / 2} y="222" textAnchor="middle" fontSize="14" fontWeight="700" fill={INK}>
                {r.month}
              </text>
            </g>
          );
        })}
        <path d="M40 200 H 410" stroke={INK} strokeWidth="2" />
      </svg>
    </div>
  );
}

function Scales({ left, right }: { left: string; right: string }) {
  const l = glyphFor(left) ?? "tin";
  const r = glyphFor(right) ?? "feather";
  return (
    <Tile>
      <div className="flex items-end gap-6">
        <div className="flex flex-col items-center">
          <Glyph name={l} size={72} />
          <div className="h-3 w-24 rounded bg-[#8b5a2b]" />
        </div>
        <div className="h-24 w-3 rounded bg-[#8b5a2b]" />
        <div className="mb-6 flex flex-col items-center">
          <Glyph name={r} size={72} />
          <div className="h-3 w-24 rounded bg-[#8b5a2b]" />
        </div>
      </div>
    </Tile>
  );
}

function WeekStrip() {
  return (
    <div className="flex flex-wrap gap-2">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
        <div key={d} className={cn("rounded-xl px-4 py-3 text-xl font-bold shadow-[0_4px_0_rgba(43,45,66,0.15)]", i < 5 ? "bg-white" : "bg-[#ffd166]")}>
          {d}
        </div>
      ))}
    </div>
  );
}

function PathSegments({ parts }: { parts: string[] }) {
  return (
    <div className="flex items-center gap-2">
      {parts.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <span className="text-2xl font-bold tabular-nums">{p} m</span>
            <div className="h-4 w-40 rounded-full bg-[color:var(--earth)]" />
          </div>
          {i < parts.length - 1 ? <span className="text-3xl">→</span> : null}
        </div>
      ))}
    </div>
  );
}

function HillHeights({ total, climbed }: { total: number; climbed: number }) {
  return (
    <svg viewBox="0 0 260 180" width={300} height={210} aria-label={`a hill ${total} metres high, ${climbed} metres climbed`}>
      <path d="M10 170 C 80 120, 120 40, 150 20 C 190 60, 230 130, 250 170 Z" fill="#8fd16a" stroke={INK} strokeWidth="3" />
      <path d="M150 20 V 170" stroke={INK} strokeWidth="2" strokeDasharray="6 6" />
      <text x="160" y="30" fontSize="18" fontWeight="700" fill={INK}>
        {total} m
      </text>
      <circle cx="70" cy="128" r="8" fill="#e63946" stroke={INK} strokeWidth="2" />
      <text x="84" y="134" fontSize="16" fontWeight="700" fill={INK}>
        {climbed} m climbed
      </text>
    </svg>
  );
}

function Ruler({ length }: { length: number }) {
  const cm = 20;
  return (
    <div className="flex flex-col items-start gap-2">
      <svg viewBox="0 0 440 30" width={440} height={30} aria-label={`a stick ${length} centimetres long`}>
        <path d={`M20 15 L ${20 + length * cm} 15`} stroke="#8b5a2b" strokeWidth="12" strokeLinecap="round" />
      </svg>
      <svg viewBox="0 0 440 60" width={440} height={60} aria-label="a ruler">
        <rect x="10" y="4" width="424" height="52" rx="4" fill="#ffd166" stroke={INK} strokeWidth="2" />
        {Array.from({ length: 21 }, (_, i) => (
          <g key={i}>
            <path d={`M${20 + i * cm} 4 V ${i % 5 === 0 ? 26 : 16}`} stroke={INK} strokeWidth="2" />
            {i % 5 === 0 ? (
              <text x={20 + i * cm} y="46" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>
                {i}
              </text>
            ) : null}
          </g>
        ))}
        <text x="420" y="46" textAnchor="end" fontSize="11" fill={INK}>
          cm
        </text>
      </svg>
    </div>
  );
}

function Purse() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {["P1", "P2", "P5"].map((c) => (
        <div key={c} className="flex size-20 items-center justify-center rounded-full border-4 border-[#e6b400] bg-[#ffd166] text-2xl font-bold shadow-[0_4px_0_#e6b400]">
          {c}
        </div>
      ))}
      {["P10", "P20"].map((n) => (
        <div key={n} className="flex h-16 w-28 items-center justify-center rounded-lg border-4 border-[#4a7bd1] bg-[#bfe6ff] text-2xl font-bold">
          {n}
        </div>
      ))}
    </div>
  );
}
