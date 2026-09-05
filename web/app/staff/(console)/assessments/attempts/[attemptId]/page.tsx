import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BAND_LABELS, parseRubricBands } from "@/lib/assessment/bands";
import { QUESTION_TYPE_LABELS } from "@/lib/assessment/keys";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { BenchmarkBand, Json, QuestionType } from "@/lib/supabase/types";
import { abandonAttempt, markWriting, remarkAttempt, submitForChild } from "../../actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type Opt = { id: string; label: string; side: "left" | "right" | null };

function options(json: Json): Opt[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((o) => {
    const r = o as Record<string, Json | undefined>;
    return typeof r.id === "string" && typeof r.label === "string"
      ? [{ id: r.id, label: r.label, side: r.side === "left" || r.side === "right" ? r.side : null }]
      : [];
  });
}

/** The child's answer, rendered readably by type. */
function renderResponse(type: QuestionType, response: Json | undefined, opts: Opt[]): string {
  if (response === undefined) return "— no answer —";
  const r = (response && typeof response === "object" && !Array.isArray(response) ? response : {}) as Record<string, Json | undefined>;
  const label = (id: unknown) => opts.find((o) => o.id === id)?.label ?? "?";
  switch (type) {
    case "single_choice":
      return label(r.option_id);
    case "multi_select":
      return Array.isArray(r.option_ids) ? r.option_ids.map(label).join(", ") : "—";
    case "numeric":
      return String(r.value ?? "—");
    case "short_text":
    case "extended_text":
      return typeof r.text === "string" ? r.text : "—";
    case "matching":
      return Array.isArray(r.pairs) ? r.pairs.map((p) => (Array.isArray(p) ? `${label(p[0])} → ${label(p[1])}` : "?")).join("; ") : "—";
    case "ordering":
      return Array.isArray(r.order) ? r.order.map(label).join(" → ") : "—";
  }
}

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const { supabase, permissions } = await requireStaff("applications.read");
  const canMark = can(permissions, "assessments.score.write");
  const canDeliver = can(permissions, "assessments.deliver");

  const { data: attempt } = await supabase
    .from("attempts")
    .select("*, applications(id, reference, child_first_name, child_last_name, status, grades!applications_grade_id_fkey(name)), staff_profiles!attempts_launched_by_fkey(full_name)")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) notFound();
  const app = one(attempt.applications)!;
  const grade = one(app.grades);
  const launcher = one(attempt.staff_profiles);

  const [{ data: questions }, { data: responses }, { data: scores }, { data: competencies }, { data: subjects }] = await Promise.all([
    supabase.from("form_questions").select("*").eq("form_id", attempt.form_id).order("section_position").order("position"),
    supabase.from("attempt_responses").select("*, staff_profiles!attempt_responses_marked_by_fkey(full_name)").eq("attempt_id", attemptId),
    supabase.from("attempt_scores").select("*").eq("attempt_id", attemptId),
    supabase.from("competencies").select("id, name, subject_id"),
    supabase.from("subjects").select("id, name"),
  ]);
  const responseByQ = new Map((responses ?? []).map((r) => [r.form_question_id, r]));
  const competencyName = new Map((competencies ?? []).map((c) => [c.id, c.name]));
  const subjectName = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const scopeName = (scope: string, id: string | null) => (scope === "overall" ? "Overall" : scope === "subject" ? subjectName.get(id ?? "") ?? "?" : competencyName.get(id ?? "") ?? "?");
  const bandVariant = (band: string) => (band === "exceeding" || band === "meeting" ? "success" : band === "approaching" ? "warning" : "destructive");

  const live = attempt.status === "ready" || attempt.status === "in_progress";
  const unmarked = (questions ?? []).filter((q) => !q.is_practice && responseByQ.has(q.id) && responseByQ.get(q.id)!.marks_awarded === null);
  const statusVariant = attempt.status === "marked" ? "success" : attempt.status === "abandoned" ? "muted" : live ? "warning" : "info";

  return (
    <>
      <PageTitle
        title={`${app.child_first_name} ${app.child_last_name} — assessment`}
        description={`${grade?.name ?? ""} · ${app.reference} · launched ${formatDateTime(attempt.launched_at)}${launcher ? ` by ${launcher.full_name}` : ""}${attempt.time_multiplier !== 1 ? ` · ${Math.round((attempt.time_multiplier - 1) * 100)}% extra time` : ""}`}
      >
        <Badge variant={statusVariant}>{attempt.status.replace("_", " ")}</Badge>
        <Badge variant="outline">marking: {attempt.marking_status.replace("_", " ")}</Badge>
        <Link href={`/staff/applications/${app.id}`} className="text-sm text-muted-foreground hover:underline">Applicant</Link>
      </PageTitle>

      {attempt.accommodation_note ? <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">Accommodation: {attempt.accommodation_note}</p> : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {canDeliver && live ? (
          <>
            <ActionForm action={submitForChild} label="Hand in for the child" size="sm" variant="secondary" confirm="Hand in the answers as they are now?">
              <input type="hidden" name="attemptId" value={attempt.id} />
            </ActionForm>
            <ActionForm action={abandonAttempt} label="Abandon sitting" size="sm" variant="destructive" className="flex items-center gap-2">
              <input type="hidden" name="attemptId" value={attempt.id} />
              <Input name="reason" placeholder="Why (required)" className="h-8 w-56 md:h-8" required />
            </ActionForm>
          </>
        ) : null}
        {canMark && !live && attempt.status !== "abandoned" ? (
          <ActionForm action={remarkAttempt} label="Re-run automatic marking" size="sm" variant="outline">
            <input type="hidden" name="attemptId" value={attempt.id} />
          </ActionForm>
        ) : null}
      </div>

      {scores?.length ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">Scores{attempt.marking_status !== "complete" ? " (provisional — writing not yet marked)" : ""}</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Scope</th><th className="px-3 py-2 font-medium">Marks</th><th className="px-3 py-2 font-medium">%</th><th className="px-3 py-2 font-medium">Band</th></tr></thead>
              <tbody className="divide-y divide-border">
                {scores.map((s) => (
                  <tr key={`${s.scope}:${s.scope_id}`} className={s.scope === "overall" ? "font-semibold" : ""}>
                    <td className="px-3 py-2">{s.scope === "competency" ? <span className="pl-4">{scopeName(s.scope, s.scope_id)}</span> : scopeName(s.scope, s.scope_id)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.raw} / {s.max}</td>
                    <td className="px-3 py-2 tabular-nums">{s.percent}%</td>
                    <td className="px-3 py-2"><Badge variant={bandVariant(s.band)}>{BAND_LABELS[s.band as BenchmarkBand] ?? s.band}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canMark && unmarked.length && !live ? (
        <section className="mb-6 rounded-xl border-2 border-warning bg-card p-4">
          <h2 className="text-sm font-semibold">{unmarked.length} response{unmarked.length === 1 ? "" : "s"} waiting for a person</h2>
          <p className="mb-3 text-xs text-muted-foreground">Read the writing, pick the band that fits, and enter the marks. A suggested band, where shown, is advice from the AI and is never applied on its own.</p>
          <ActionForm action={markWriting} label="Save marks" size="sm" className="space-y-5">
            <input type="hidden" name="attemptId" value={attempt.id} />
            {unmarked.map((q) => {
              const r = responseByQ.get(q.id)!;
              const rubric = q.rubric_snapshot && typeof q.rubric_snapshot === "object" && !Array.isArray(q.rubric_snapshot)
                ? (q.rubric_snapshot as { max_marks?: number; bands?: Json })
                : null;
              const bands = parseRubricBands(rubric?.bands ?? null);
              const suggestion = r.ai_suggestion && typeof r.ai_suggestion === "object" && !Array.isArray(r.ai_suggestion)
                ? (r.ai_suggestion as { band?: string; rationale?: string })
                : null;
              return (
                <div key={q.id} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{competencyName.get(q.competency_id)} · {QUESTION_TYPE_LABELS[q.type]} · up to {q.marks} marks</p>
                  <p className="mt-1 text-sm font-medium">{q.stem}</p>
                  <blockquote className="mt-2 rounded-md bg-muted/60 p-3 text-sm whitespace-pre-line">{renderResponse(q.type, r.response, options(q.options))}</blockquote>
                  {suggestion?.band ? (
                    <p className="mt-2 rounded-md bg-info/10 px-3 py-2 text-xs text-info">Suggested band: <strong>{bands.find((b) => b.key === suggestion.band)?.label ?? suggestion.band}</strong>{suggestion.rationale ? ` — ${suggestion.rationale}` : ""}</p>
                  ) : null}
                  {bands.length ? (
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {bands.map((b) => (
                        <label key={b.key} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                          <input type="radio" name={`band_${r.id}`} value={b.min_marks} className="mt-0.5" />
                          <span><strong>{b.label}</strong> ({b.min_marks} marks) — {b.descriptor}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-warning-foreground">No rubric on this question. Award marks by hand.</p>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <label htmlFor={`marks_${r.id}`}>Marks awarded</label>
                    <Input id={`marks_${r.id}`} name={`marks_${r.id}`} type="number" step="0.5" min={0} max={q.marks} className="h-8 w-24 md:h-8" placeholder="—" />
                    <span className="text-xs text-muted-foreground">of {q.marks}</span>
                  </div>
                </div>
              );
            })}
          </ActionForm>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Every question</h2>
        <ol className="space-y-2">
          {(questions ?? []).filter((q) => !q.is_practice).map((q, i) => {
            const r = responseByQ.get(q.id);
            const marker = r ? one(r.staff_profiles) : null;
            return (
              <li key={q.id} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{i + 1}. {q.section_title} · {competencyName.get(q.competency_id)} · {QUESTION_TYPE_LABELS[q.type]}</p>
                  <p className="text-xs tabular-nums">
                    {r?.marks_awarded !== null && r?.marks_awarded !== undefined ? (
                      <span className={r.is_correct === false && Number(r.marks_awarded) === 0 ? "text-destructive" : "text-success"}>
                        {r.marks_awarded} / {q.marks}{r.marking_method === "rubric" ? ` · marked by ${marker?.full_name ?? "staff"}` : ""}
                      </span>
                    ) : r ? (
                      <span className="text-warning-foreground">unmarked / {q.marks}</span>
                    ) : (
                      <span className="text-muted-foreground">no answer · 0 / {q.marks}</span>
                    )}
                  </p>
                </div>
                <p className="mt-1 font-medium">{q.stem}</p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">{renderResponse(q.type, r?.response, options(q.options))}</p>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
