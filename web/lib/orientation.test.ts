import { describe, expect, it } from "vitest";
import {
  chapterIndex,
  completesOrientation,
  nextChapter,
  ORIENTATION_CHAPTERS,
  ORIENTATION_SLUGS,
  orientationChapter,
  orientationProgress,
  previousChapter,
} from "@/lib/orientation";
import { ORIENTATION_BODIES } from "@/components/staff/orientation/chapters";

describe("orientation chapters", () => {
  it("every chapter has a body, and every body a chapter", () => {
    // A slug in one and not the other is a 404 on a screen the index links
    // to, or a screen nobody can reach — neither shows up until somebody
    // clicks it, which is why it is checked here.
    expect(Object.keys(ORIENTATION_BODIES).sort()).toEqual([...ORIENTATION_SLUGS].sort());
  });

  it("has unique, url-shaped slugs", () => {
    expect(new Set(ORIENTATION_SLUGS).size).toBe(ORIENTATION_SLUGS.length);
    for (const slug of ORIENTATION_SLUGS) expect(slug).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
  });

  it("reads as one path from first to last", () => {
    const first = ORIENTATION_CHAPTERS[0];
    const last = ORIENTATION_CHAPTERS[ORIENTATION_CHAPTERS.length - 1];
    expect(previousChapter(first.slug)).toBeNull();
    expect(nextChapter(last.slug)).toBeNull();
    let steps = 0;
    let at = first;
    for (let n = nextChapter(at.slug); n; n = nextChapter(at.slug)) {
      at = n;
      steps += 1;
      if (steps > 100) throw new Error("walked in a circle");
    }
    expect(steps).toBe(ORIENTATION_CHAPTERS.length - 1);
    expect(at.slug).toBe(last.slug);
  });

  it("finds a chapter by slug and refuses one that is not there", () => {
    expect(orientationChapter(ORIENTATION_SLUGS[0])?.slug).toBe(ORIENTATION_SLUGS[0]);
    expect(orientationChapter("not-a-screen")).toBeNull();
    expect(chapterIndex("not-a-screen")).toBe(-1);
  });
});

describe("orientation progress", () => {
  it("counts nothing read", () => {
    const p = orientationProgress([]);
    expect(p).toMatchObject({ read: 0, total: ORIENTATION_CHAPTERS.length, done: false });
    expect(p.remaining[0].slug).toBe(ORIENTATION_CHAPTERS[0].slug);
  });

  it("treats a null column as nothing read", () => {
    expect(orientationProgress(null).read).toBe(0);
  });

  it("is done only when every chapter is read", () => {
    const all = [...ORIENTATION_SLUGS];
    expect(orientationProgress(all).done).toBe(true);
    expect(orientationProgress(all.slice(0, -1)).done).toBe(false);
  });

  it("ignores a slug that is no longer a chapter", () => {
    // A screen renamed after somebody read it must not count towards their
    // total, or leave them "12 of 11" and finished on a screen that is gone.
    const stale = [...ORIENTATION_SLUGS.slice(0, 2), "a-screen-we-renamed"];
    const p = orientationProgress(stale);
    expect(p.read).toBe(2);
    expect(p.total).toBe(ORIENTATION_CHAPTERS.length);
    expect(p.done).toBe(false);
  });

  it("knows which press is the last one", () => {
    const all = [...ORIENTATION_SLUGS];
    const last = all[all.length - 1];
    expect(completesOrientation(all.slice(0, -1), last)).toBe(true);
    expect(completesOrientation(all.slice(0, -2), last)).toBe(false);
    // Re-reading the last screen when everything is already read still counts
    // as finishing rather than as un-finishing.
    expect(completesOrientation(all, last)).toBe(true);
  });
});
