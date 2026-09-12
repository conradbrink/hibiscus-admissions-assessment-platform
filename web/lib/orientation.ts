import type { PermissionCode, PermissionSet } from "@/lib/permissions";
import { can } from "@/lib/permissions";

/**
 * The orientation: eleven screens in the order a family moves through the
 * system, not the order the menu is in. A new colleague reads it once; the
 * console stops offering it the moment they finish.
 *
 * The chapters are data rather than pages so that the index, the progress
 * count, the next/previous links and the "you are done" test all read the
 * same list. The body of each screen is JSX, in
 * `components/staff/orientation/chapters.tsx`, keyed by these slugs.
 */
export type OrientationChapter = {
  slug: string;
  /** The act line, in the screenplay sense: where this scene sits. */
  eyebrow: string;
  title: string;
  /** One sentence on the index card. */
  summary: string;
  minutes: number;
  /**
   * What the screen is *about*. When the reader does not hold it, the screen
   * still shows — knowing what a colleague does is half of knowing your own
   * job — but it says plainly that this part is not theirs to do.
   */
  permission?: PermissionCode;
};

export const ORIENTATION_CHAPTERS: readonly OrientationChapter[] = [
  {
    slug: "signing-in",
    eyebrow: "Act one",
    title: "Signing in, and what you can see",
    summary: "Your role and your campuses decide the whole shape of the console. Start here or nothing else makes sense.",
    minutes: 3,
  },
  {
    slug: "dashboard",
    eyebrow: "Act two",
    title: "The dashboard, and the first five minutes",
    summary: "What is happening today, what is yours, where everybody is, and what is stuck — in that order.",
    minutes: 2,
    permission: "applications.read",
  },
  {
    slug: "a-family-arrives",
    eyebrow: "Act three",
    title: "A family arrives",
    summary: "The enquiry a parent fills in on their phone, and the one you take at the desk. They end up in the same place.",
    minutes: 3,
    permission: "applications.read",
  },
  {
    slug: "the-profile",
    eyebrow: "Act three",
    title: "The applicant's profile",
    summary: "The page you will spend your day on, corner by corner.",
    minutes: 4,
    permission: "applications.read",
  },
  {
    slug: "the-day",
    eyebrow: "Act four",
    title: "The day itself",
    summary: "Check-in, the code that works once, and why a pre-school morning has neither.",
    minutes: 4,
    permission: "assessments.deliver",
  },
  {
    slug: "marking",
    eyebrow: "Act four",
    title: "Marking, and the learning profile",
    summary: "What the computer marks, what a person marks, and what the AI is and is not allowed to do.",
    minutes: 3,
    permission: "assessments.deliver",
  },
  {
    slug: "the-decision",
    eyebrow: "Act five",
    title: "The decision",
    summary: "Approve, waitlist, decline, defer, withdraw — five answers, one box.",
    minutes: 4,
    permission: "applications.read",
  },
  {
    slug: "offer-and-money",
    eyebrow: "Act six",
    title: "The offer, and the money",
    summary: "An approval drafts a letter; a person sends it. What paid means, and what it does not.",
    minutes: 4,
    permission: "offers.read",
  },
  {
    slug: "registration-and-after",
    eyebrow: "Act seven",
    title: "Registration, and the child who is now a student",
    summary: "The paperwork stretch, enrolment, and the handover into school life.",
    minutes: 4,
    permission: "applications.read",
  },
  {
    slug: "tasks-and-trouble",
    eyebrow: "Act eight",
    title: "Tasks, and the things that go wrong",
    summary: "Writing a task down, ticking it off, and the fix for each of the seven things that happen most.",
    minutes: 3,
    permission: "applications.read",
  },
  {
    slug: "settings-and-rules",
    eyebrow: "Act nine",
    title: "Settings, and five things that are always true",
    summary: "The room you enter with a reason, the rules that do not bend, and the words you will hear.",
    minutes: 4,
  },
] as const;

export const ORIENTATION_SLUGS: readonly string[] = ORIENTATION_CHAPTERS.map((c) => c.slug);

export const ORIENTATION_MINUTES = ORIENTATION_CHAPTERS.reduce((n, c) => n + c.minutes, 0);

export function orientationChapter(slug: string): OrientationChapter | null {
  return ORIENTATION_CHAPTERS.find((c) => c.slug === slug) ?? null;
}

export function chapterIndex(slug: string): number {
  return ORIENTATION_CHAPTERS.findIndex((c) => c.slug === slug);
}

/** The screen after this one, or null at the end. */
export function nextChapter(slug: string): OrientationChapter | null {
  const i = chapterIndex(slug);
  return i < 0 ? null : (ORIENTATION_CHAPTERS[i + 1] ?? null);
}

export function previousChapter(slug: string): OrientationChapter | null {
  const i = chapterIndex(slug);
  return i <= 0 ? null : (ORIENTATION_CHAPTERS[i - 1] ?? null);
}

/**
 * How far along somebody is. Slugs that are no longer chapters — a screen
 * renamed after they read it — are ignored rather than counted, so a rename
 * never leaves a person "12 of 11 read" and never marks them finished on a
 * screen that no longer exists.
 */
export function orientationProgress(read: readonly string[] | null | undefined): {
  read: number;
  total: number;
  remaining: OrientationChapter[];
  done: boolean;
} {
  const seen = new Set(read ?? []);
  const remaining = ORIENTATION_CHAPTERS.filter((c) => !seen.has(c.slug));
  return {
    read: ORIENTATION_CHAPTERS.length - remaining.length,
    total: ORIENTATION_CHAPTERS.length,
    remaining,
    done: remaining.length === 0,
  };
}

/**
 * Reading this screen once its last unread chapter is ticked finishes the
 * orientation. Worked out here rather than in the action so the button can
 * say so before it is pressed.
 */
export function completesOrientation(read: readonly string[] | null | undefined, slug: string): boolean {
  const seen = new Set(read ?? []);
  seen.add(slug);
  return ORIENTATION_CHAPTERS.every((c) => seen.has(c.slug));
}

/** "This part of the job is not yours" — shown at the top of a screen, not hidden. */
export function chapterIsYours(permissions: PermissionSet, chapter: OrientationChapter): boolean {
  return chapter.permission === undefined || can(permissions, chapter.permission);
}
