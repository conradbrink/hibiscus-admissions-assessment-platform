import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { ORIENTATION_BODIES } from "@/components/staff/orientation/chapters";
import {
  chapterIndex,
  chapterIsYours,
  completesOrientation,
  nextChapter,
  ORIENTATION_CHAPTERS,
  orientationChapter,
  previousChapter,
} from "@/lib/orientation";
import { requireStaff } from "@/lib/staff/session";
import { markChapterRead } from "../actions";

/** One screen of the orientation, with the way on at the bottom. */
export default async function OrientationChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chapter = orientationChapter(slug);
  const Body = ORIENTATION_BODIES[slug];
  if (!chapter || !Body) notFound();

  const { profile, permissions } = await requireStaff();
  const read = (profile.orientation_read ?? []).includes(slug);
  const finishes = completesOrientation(profile.orientation_read, slug);
  const previous = previousChapter(slug);
  const next = nextChapter(slug);
  const position = chapterIndex(slug) + 1;

  return (
    <>
      <PageTitle
        back={{ href: "/staff/orientation", label: "Orientation" }}
        title={chapter.title}
        description={`${chapter.eyebrow} · screen ${position} of ${ORIENTATION_CHAPTERS.length} · about ${chapter.minutes} minutes`}
      >
        {read ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success-foreground">
            <Check className="size-3.5" aria-hidden /> Read
          </span>
        ) : null}
      </PageTitle>

      {!chapterIsYours(permissions, chapter) ? (
        <p className="mb-4 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This part of the job is not yours to do — your role does not include it. Read it anyway: it is what happens
          either side of your own work.
        </p>
      ) : null}

      <Body />

      <nav className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm">
          {previous ? (
            <Link href={`/staff/orientation/${previous.slug}`} className="text-primary hover:underline">
              ← {previous.title}
            </Link>
          ) : (
            <Link href="/staff/orientation" className="text-muted-foreground hover:underline">
              ← Contents
            </Link>
          )}
        </div>

        {/* One button, and what it says depends on where you are: the last
            screen is the one that ends the orientation, and it should say so
            before it is pressed. */}
        <ActionForm
          action={markChapterRead}
          label={finishes && !read ? "Finish the orientation" : next ? "Mark read and continue" : "Mark read and go back"}
          size="sm"
          className="flex items-center gap-2 space-y-0"
        >
          <input type="hidden" name="slug" value={slug} />
        </ActionForm>
      </nav>

    </>
  );
}
