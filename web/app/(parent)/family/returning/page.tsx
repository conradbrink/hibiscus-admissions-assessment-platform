import type { Metadata } from "next";
import { PageHeader } from "@/components/parent/page-header";
import { ReturningForm } from "@/components/parent/returning-form";
import { loadOpenQuestions } from "@/lib/family/reenrolment";
import { familyClient, loadFamilyContacts } from "@/lib/family/scope";
import { formatDateLong } from "@/lib/format-date";
import { requireFamilySession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "Coming back next term" };

/**
 * "Is she coming back?" — one question per child, and then the chance to
 * tell us anything we hold that has changed.
 *
 * Three answers, not two. "Not sure yet" is the honest thing a parent often
 * has to say, and offering it is what stops the whole question going
 * unanswered — which reads to the school exactly like never having asked.
 */
export default async function ReturningPage() {
  const session = await requireFamilySession();
  const admin = familyClient();

  const [questions, contacts] = await Promise.all([
    loadOpenQuestions(admin, session),
    loadFamilyContacts(admin, session),
  ]);

  if (questions.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Nothing to do"
          title="There is nothing to answer right now."
          description="When the school next asks about the coming term, we will send you a link."
        />
      </>
    );
  }

  const closes = questions[0].cycle.closesOn;
  const askDetails = questions.some((q) => q.cycle.askDetails);

  return (
    <>
      <PageHeader
        eyebrow={questions[0].cycle.termLabel ?? "Next term"}
        title={questions.length === 1 ? "Is your child coming back?" : "Are your children coming back?"}
        description={`Please tell us by ${formatDateLong(closes)}. It takes a minute, and it is how we hold their place.`}
      />

      <div className="space-y-4">
        {questions.map((q) => (
          <ReturningForm
            key={q.responseId}
            responseId={q.responseId}
            childName={q.student.preferred_name || q.student.legal_first_name}
            grade={q.student.grade?.name ?? null}
            campus={q.student.campus?.name ?? null}
            intent={q.intent}
            answeredAt={q.answeredAt}
          />
        ))}
      </div>

      {askDetails ? (
        <section className="mt-8 rounded-2xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-semibold">Is this still right?</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This is who we contact about your children. If something here is wrong, tell us what has
            changed and we will put it right.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {contacts.map((c) => (
              <li key={c.id}>
                {c.first_name} {c.last_name}
                <span className="block text-xs text-muted-foreground">
                  {c.email}
                  {c.mobile ? ` · ${c.mobile}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <ReturningForm
            responseId={questions[0].responseId}
            confirmOnly
            childName=""
            grade={null}
            campus={null}
            intent={null}
            answeredAt={null}
          />
        </section>
      ) : null}
    </>
  );
}
