import Link from "next/link";
import { Check } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import {
  chapterIsYours,
  ORIENTATION_CHAPTERS,
  ORIENTATION_MINUTES,
  orientationProgress,
} from "@/lib/orientation";
import { requireStaff } from "@/lib/staff/session";
import { restartOrientation } from "./actions";

/**
 * The contents page.
 *
 * Eleven screens, in the order a family moves through the system rather than
 * the order the menu is in — which is the whole argument of the thing: the
 * console makes sense as a journey and does not make sense as a list of
 * pages.
 */
export default async function OrientationIndexPage() {
  const { profile, permissions } = await requireStaff();
  const progress = orientationProgress(profile.orientation_read);
  const next = progress.remaining[0] ?? null;

  return (
    <>
      <PageTitle
        title="Orientation"
        description={`How the admissions system works, in the order a family moves through it. ${ORIENTATION_CHAPTERS.length} screens, about ${ORIENTATION_MINUTES} minutes in total. It stops asking once you have read them all.`}
      />

      <section className="surface mb-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              {progress.done
                ? "You have read all of it."
                : progress.read === 0
                  ? "Nothing read yet."
                  : `${progress.read} of ${progress.total} read.`}
            </p>
            <p className="text-xs text-muted-foreground">
              {progress.done
                ? "The console has stopped offering this. It stays here if you want to look something up."
                : "Your place is saved as you go, so you can stop and come back."}
            </p>
          </div>
          {next ? (
            <Link
              href={`/staff/orientation/${next.slug}`}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {progress.read === 0 ? "Start" : "Continue"} — {next.title}
            </Link>
          ) : (
            <ActionForm action={restartOrientation} label="Read it again from the start" variant="outline" size="sm" confirm="Clear your progress and start the orientation again?">
              <input type="hidden" name="confirm" value="restart" />
            </ActionForm>
          )}
        </div>
        {/* A bar rather than a number alone: eleven screens is a lot to be told
            about in digits at the start of a first day. */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.round((progress.read / progress.total) * 100)}%` }}
          />
        </div>
      </section>

      <ol className="space-y-2">
        {ORIENTATION_CHAPTERS.map((c, i) => {
          const read = (profile.orientation_read ?? []).includes(c.slug);
          const yours = chapterIsYours(permissions, c);
          return (
            <li key={c.slug}>
              <Link
                href={`/staff/orientation/${c.slug}`}
                className="surface flex items-start gap-3 px-4 py-3.5 transition-shadow hover:shadow-lift"
              >
                <span
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    read ? "bg-success text-success-foreground" : "bg-accent text-primary"
                  }`}
                >
                  {read ? <Check className="size-4" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                    {c.eyebrow} · {c.minutes} min{read ? " · read" : ""}
                  </span>
                  <span className="block text-sm font-semibold">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">{c.summary}</span>
                  {/* Said out loud rather than hidden: knowing what a colleague
                      does is half of knowing where your own work goes. */}
                  {!yours ? (
                    <span className="mt-1 block text-xs text-muted-foreground italic">
                      Not part of your role — read it for what happens either side of you.
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}
