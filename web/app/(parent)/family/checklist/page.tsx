import type { Metadata } from "next";
import Link from "next/link";
import { ChecklistItem } from "@/components/parent/checklist-item";
import { PageHeader } from "@/components/parent/page-header";
import { loadFamilyChecklists } from "@/lib/family/onboarding";
import { familyClient } from "@/lib/family/scope";
import { formatDateLong, toSchoolDateString } from "@/lib/format-date";
import { onboardingProgress, parentChecklist } from "@/lib/onboarding/progress";
import { requireFamilySession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "What is still to do" };

const optionsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * The family's checklist: what each child still needs, and what is finished.
 *
 * One list per child, and the school's own steps are not on it — "allocate
 * the class" is a promise the school made, not a chore to hand a parent who
 * cannot do it. Finished items stay visible: a list that shortens as you work
 * it hides what you have achieved.
 */
export default async function ChecklistPage() {
  const session = await requireFamilySession();
  const admin = familyClient();
  const { steps, children } = await loadFamilyChecklists(admin, session);
  const today = toSchoolDateString(new Date());

  if (children.length === 0) {
    return (
      <PageHeader
        eyebrow="Nothing to do"
        title="There is nothing on your list."
        description="When your child is enrolled, what we need from you will appear here."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Before the first day"
        title="What is still to do"
        description="Each of these stands alone. Do them in any order, on any device."
      />

      <div className="space-y-8">
        {children.map(({ student, items }) => {
          const mine = parentChecklist(
            steps.map((s) => ({ ...s })),
            items
          );
          const progress = onboardingProgress(steps, items, today);
          const name = student.preferred_name || student.legal_first_name;

          return (
            <section key={student.id}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-medium">{name}</h2>
                <p className="text-xs text-muted-foreground">
                  {progress.complete
                    ? "All done — thank you."
                    : `${progress.requiredDone} of ${progress.requiredTotal} done`}
                </p>
              </div>
              <div
                className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${name}'s checklist`}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
              </div>

              {mine.length ? (
                <ul className="space-y-3">
                  {mine.map((i) => (
                    <ChecklistItem
                      key={i.id}
                      itemId={i.id}
                      label={i.step.label}
                      description={i.step.description}
                      kind={i.step.kind}
                      options={optionsOf(i.step.options)}
                      status={i.status}
                      dueOn={i.due_on ? formatDateLong(i.due_on) : null}
                      // The class group's own invite link arrives with the
                      // group itself; until then the step explains and waits.
                      linkUrl={null}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing for you to do for {name} right now.</p>
              )}
            </section>
          );
        })}
      </div>

      {/* The onboarding messages land here, so this is the only way a parent
          finds the extras at all. */}
      <p className="mt-8 text-sm text-muted-foreground">
        There are also things you can <Link href="/family/extras" className="underline underline-offset-4">order for your child</Link> —
        stationery, transport, lunch and aftercare. All optional.
      </p>
    </>
  );
}
