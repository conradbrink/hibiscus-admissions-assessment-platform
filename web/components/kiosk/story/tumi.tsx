"use client";

import { cn } from "@/lib/utils";

export type TumiMood = "idle" | "talk" | "happy" | "think" | "wave";

/**
 * Tumi, the little dinosaur who tells the story. Drawn once as SVG; the
 * moods are CSS classes in story.css (blink, breathe, tail, talk, hop,
 * wave, think), so changing how Tumi feels costs nothing.
 */
export function Tumi({ mood = "idle", className }: { mood?: TumiMood; className?: string }) {
  return (
    <svg
      viewBox="0 0 240 240"
      className={cn("tumi", mood === "talk" && "is-talk", mood === "happy" && "is-happy", mood === "wave" && "is-wave", mood === "think" && "is-think", className)}
      role="img"
      aria-label="Tumi the dinosaur"
    >
      {/* shadow */}
      <ellipse cx="120" cy="226" rx="72" ry="10" fill="rgba(0,0,0,0.12)" />
      {/* tail */}
      <g className="tumi-tail">
        <path d="M52 176 C 20 168, 8 150, 18 128 C 22 146, 40 156, 66 158 Z" fill="var(--tumi)" />
        <path d="M30 138 l-8 -12 l12 4 z" fill="var(--tumi-spike)" />
      </g>
      <g className="tumi-body">
        {/* back legs */}
        <ellipse cx="82" cy="206" rx="22" ry="16" fill="var(--tumi-dark)" />
        <ellipse cx="158" cy="206" rx="22" ry="16" fill="var(--tumi-dark)" />
        {/* body */}
        <path d="M60 212 C 40 180, 52 120, 100 106 C 150 92, 190 120, 186 170 C 184 198, 168 214, 140 218 Z" fill="var(--tumi)" />
        {/* belly */}
        <path d="M84 206 C 74 180, 86 138, 118 128 C 150 120, 172 146, 168 178 C 166 196, 150 208, 128 210 Z" fill="var(--tumi-belly)" />
        {/* spikes along the back */}
        <path d="M96 112 l10 -22 l10 20 z M120 104 l10 -24 l10 22 z M146 108 l10 -22 l8 22 z" fill="var(--tumi-spike)" />
        {/* front legs */}
        <ellipse cx="104" cy="214" rx="20" ry="13" fill="var(--tumi)" />
        <ellipse cx="146" cy="214" rx="20" ry="13" fill="var(--tumi)" />
        {/* arms */}
        <path d="M94 150 c -16 6, -20 24, -8 32" stroke="var(--tumi-dark)" strokeWidth="12" strokeLinecap="round" fill="none" />
        <path className="tumi-arm-front" d="M166 146 c 18 4, 26 20, 16 34" stroke="var(--tumi)" strokeWidth="12" strokeLinecap="round" fill="none" />
        {/* head */}
        <g className="tumi-head">
          <path d="M104 110 C 96 64, 132 40, 172 48 C 210 56, 214 100, 190 118 C 170 132, 122 132, 104 110 Z" fill="var(--tumi)" />
          {/* snout */}
          <path d="M168 96 C 190 92, 214 100, 214 112 C 214 124, 190 128, 168 122 Z" fill="var(--tumi-belly)" />
          <circle cx="204" cy="106" r="3" fill="var(--tumi-dark)" />
          {/* mouth */}
          <path className="tumi-mouth" d="M166 118 q 22 22 44 4 q -22 6 -44 -4 z" fill="#a83a5b" />
          {/* cheeks */}
          <circle cx="150" cy="106" r="9" fill="#ffb3b3" opacity="0.8" />
          {/* eye */}
          <ellipse cx="150" cy="82" rx="16" ry="18" fill="#fff" />
          <circle cx="154" cy="84" r="8" fill="#22252b" />
          <circle cx="157" cy="80" r="3" fill="#fff" />
          {/* eyelid: closes over the eye on the blink keyframe */}
          <ellipse className="tumi-eye-lid" cx="150" cy="82" rx="17" ry="19" fill="var(--tumi)" />
          {/* head crest */}
          <path d="M128 56 l6 -18 l10 16 z" fill="var(--tumi-spike)" />
        </g>
      </g>
    </svg>
  );
}
