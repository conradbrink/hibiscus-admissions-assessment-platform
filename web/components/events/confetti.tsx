import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Confetti drifting down behind the top of a festive event page, in the gold,
 * red and green of the school's Christmas flyer.
 *
 * CSS only (`confetti-fall` in app/globals.css): no script to load or run on
 * a phone that came from a WhatsApp link. Each piece moves by transform and
 * fades by opacity, so drawing it costs next to nothing, and it fades in and
 * out of its loop so the restart is never seen. With reduced motion asked
 * for, every piece stays still where it sits.
 *
 * The pieces are written out rather than generated so the page renders the
 * same on the server and in the browser.
 */

type Piece = {
  left: string;
  top: string;
  shape: "strip" | "dot";
  color: string;
  /** Seconds for one fall. Slow on purpose: this is the background. */
  duration: number;
  /** Negative, so the pieces are already mid-fall when the page opens. */
  delay: number;
  drift: string;
  spin: number;
  opacity: number;
};

const GOLD = "#ffd68a";
const ORANGE = "#f26a2e";
const RED = "#e2483d";
const GREEN = "#3fae6a";
const SNOW = "#fff8ec";

const PIECES: Piece[] = [
  { left: "4%", top: "6%", shape: "strip", color: GOLD, duration: 13, delay: -2, drift: "1.5rem", spin: 600, opacity: 0.9 },
  { left: "8%", top: "66%", shape: "dot", color: GOLD, duration: 12.8, delay: -5.5, drift: "1rem", spin: 0, opacity: 0.7 },
  { left: "11%", top: "38%", shape: "dot", color: SNOW, duration: 15, delay: -9, drift: "-1rem", spin: 0, opacity: 0.6 },
  { left: "17%", top: "14%", shape: "strip", color: RED, duration: 11, delay: -5, drift: "2rem", spin: 720, opacity: 0.85 },
  { left: "24%", top: "52%", shape: "strip", color: GOLD, duration: 14, delay: -11, drift: "-1.5rem", spin: 540, opacity: 0.8 },
  { left: "31%", top: "4%", shape: "dot", color: ORANGE, duration: 12, delay: -3, drift: "1rem", spin: 0, opacity: 0.8 },
  { left: "38%", top: "30%", shape: "strip", color: GREEN, duration: 16, delay: -7, drift: "2.5rem", spin: 640, opacity: 0.8 },
  { left: "45%", top: "10%", shape: "strip", color: GOLD, duration: 12.5, delay: -1, drift: "-2rem", spin: 760, opacity: 0.9 },
  { left: "48%", top: "70%", shape: "strip", color: RED, duration: 14.2, delay: -3.5, drift: "-1.2rem", spin: 650, opacity: 0.75 },
  { left: "52%", top: "44%", shape: "dot", color: GOLD, duration: 14.5, delay: -10, drift: "1.2rem", spin: 0, opacity: 0.7 },
  { left: "58%", top: "20%", shape: "strip", color: SNOW, duration: 13.5, delay: -6, drift: "-1rem", spin: 580, opacity: 0.7 },
  { left: "64%", top: "6%", shape: "strip", color: RED, duration: 15.5, delay: -12, drift: "1.8rem", spin: 700, opacity: 0.85 },
  { left: "70%", top: "36%", shape: "dot", color: GREEN, duration: 11.5, delay: -4, drift: "-1.4rem", spin: 0, opacity: 0.75 },
  { left: "76%", top: "16%", shape: "strip", color: GOLD, duration: 14, delay: -8, drift: "2.2rem", spin: 620, opacity: 0.9 },
  { left: "82%", top: "48%", shape: "strip", color: ORANGE, duration: 12, delay: -2.5, drift: "-1.6rem", spin: 680, opacity: 0.8 },
  { left: "88%", top: "8%", shape: "dot", color: SNOW, duration: 16, delay: -13, drift: "1rem", spin: 0, opacity: 0.6 },
  { left: "93%", top: "28%", shape: "strip", color: GOLD, duration: 13, delay: -6.5, drift: "-2rem", spin: 560, opacity: 0.85 },
  { left: "97%", top: "56%", shape: "strip", color: GREEN, duration: 15, delay: -9.5, drift: "1.5rem", spin: 740, opacity: 0.8 },
];

export function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className={cn("confetti-piece absolute", p.shape === "strip" ? "h-2.5 w-1 rounded-[1px]" : "size-1.5 rounded-full")}
          style={
            {
              left: p.left,
              top: p.top,
              backgroundColor: p.color,
              "--confetti-duration": `${p.duration}s`,
              "--confetti-delay": `${p.delay}s`,
              "--confetti-drift": p.drift,
              "--confetti-spin": `${p.spin}deg`,
              "--confetti-opacity": p.opacity,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
