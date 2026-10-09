import { PageTitle } from "@/components/staff/page-title";
import { BAND_LABELS, COMPETENCY_LABELS, parseRubric } from "@/lib/questions/rubric";
import { requireStaff } from "@/lib/staff/session";

/**
 * The banks every vacancy starts from: Pre-school, Primary and Secondary,
 * each with core questions (every vacancy) and a pool the AI chooses from.
 * Wording is seeded by migration so a change is reviewed like code; a
 * vacancy's own copy can be edited freely before it is published.
 */
export default async function QuestionBanksPage() {
  const ctx = await requireStaff("hr.questions.write");
  const [{ data: banks }, { data: questions }] = await Promise.all([
    ctx.supabase.from("hr_question_banks").select("*").eq("is_active", true).order("code"),
    ctx.supabase.from("hr_bank_questions").select("*").eq("is_active", true).order("sort_order"),
  ]);
  const order = ["preschool", "primary", "secondary", "general"];
  const sorted = [...(banks ?? [])].sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
  return (
    <>
      <PageTitle title="Question banks" description="Where every vacancy's interview questions start. Core questions go to every vacancy in the phase; the AI picks from the pool and tailors to the post." />
      <div className="space-y-8">
        {sorted.map((bank) => {
          const qs = (questions ?? []).filter((q) => q.bank_id === bank.id);
          return (
            <section key={bank.id} className="surface p-5">
              <h2 className="text-lg font-semibold">{bank.name}</h2>
              <p className="text-sm text-muted-foreground">{bank.description}</p>
              {qs.length ? (
                <ol className="mt-4 space-y-3">
                  {qs.map((q) => {
                    const rubric = parseRubric(q.rubric);
                    return (
                      <li key={q.id} className="rounded-xl border border-border/70 p-4">
                        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          {q.kind === "core" ? "Core" : "Pool"} · {COMPETENCY_LABELS[q.competency]} · {q.word_limit} words
                        </p>
                        <p className="mt-1 font-medium">{q.prompt}</p>
                        {q.guidance ? <p className="mt-1 text-sm text-muted-foreground">{q.guidance}</p> : null}
                        {rubric ? (
                          <details className="mt-2 text-sm">
                            <summary className="cursor-pointer text-muted-foreground">Rubric</summary>
                            <dl className="mt-2 space-y-1">
                              {rubric.bands.map((b) => (
                                <div key={b.band} className="grid grid-cols-[7rem_1fr] gap-2">
                                  <dt className="font-medium">
                                    {b.band} · {BAND_LABELS[b.band]}
                                  </dt>
                                  <dd className="text-muted-foreground">{b.descriptor}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No questions in this bank yet.</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
