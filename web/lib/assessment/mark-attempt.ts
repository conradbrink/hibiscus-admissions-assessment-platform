import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { AttemptRow, BenchmarkScope, Json, QuestionType } from "@/lib/supabase/types";
import { parseBenchmarkBands } from "@/lib/assessment/bands";
import { parseAnswerKey } from "@/lib/assessment/keys";
import { markResponse } from "@/lib/assessment/marking";
import { computeScores, type BenchmarkRule, type ScoredItem } from "@/lib/assessment/scoring";

/**
 * Marks a submitted attempt and writes its scores.
 *
 * Runs under the service role because it reads the keys. Idempotent: it
 * re-marks every objective item from scratch and never touches a mark a
 * person gave against a rubric, so it can run after the child submits,
 * after an assessor marks the writing, and after somebody clicks Re-mark.
 *
 * The outcome says whether the attempt is now fully marked. The caller
 * (the job handler or the staff action) decides what that means for the
 * application — this module knows nothing about the pipeline.
 */

export type MarkOutcome = {
  attempt: AttemptRow;
  complete: boolean;
  /** Form question ids still needing a person. */
  awaiting: string[];
  /** Form question ids whose key was unusable: an authoring fault. */
  unmarkable: string[];
};

export async function markAttempt(admin: AdminClient, attemptId: string): Promise<MarkOutcome> {
  const { data: attempt, error: aErr } = await admin.from("attempts").select("*").eq("id", attemptId).single();
  if (aErr || !attempt) throw new Error(aErr?.message ?? "attempt missing");
  if (attempt.status !== "submitted" && attempt.status !== "marked") {
    throw new Error(`Attempt is ${attempt.status}, not submitted`);
  }

  const [{ data: questions, error: qErr }, { data: keys, error: kErr }, { data: responses, error: rErr }, { data: app, error: appErr }] =
    await Promise.all([
      admin
        .from("form_questions")
        .select("id, type, marks, competency_id, is_practice, competencies(subject_id)")
        .eq("form_id", attempt.form_id)
        .eq("is_practice", false),
      admin
        .from("form_answer_keys")
        .select("form_question_id, answer, partial_credit")
        .in(
          "form_question_id",
          (
            await admin.from("form_questions").select("id").eq("form_id", attempt.form_id)
          ).data?.map((q) => q.id) ?? []
        ),
      admin.from("attempt_responses").select("*").eq("attempt_id", attemptId),
      admin
        .from("applications")
        .select("id, grades!applications_grade_id_fkey(sort_order)")
        .eq("id", attempt.application_id)
        .single(),
    ]);
  if (qErr) throw new Error(qErr.message);
  if (kErr) throw new Error(kErr.message);
  if (rErr) throw new Error(rErr.message);
  if (appErr || !app) throw new Error(appErr?.message ?? "application missing");

  const grade = Array.isArray(app.grades) ? app.grades[0] : app.grades;
  const gradeSort = (grade as { sort_order: number } | null)?.sort_order ?? 0;
  const keyById = new Map((keys ?? []).map((k) => [k.form_question_id, k]));
  const responseByQ = new Map((responses ?? []).map((r) => [r.form_question_id, r]));

  const items: ScoredItem[] = [];
  const awaiting: string[] = [];
  const unmarkable: string[] = [];
  const updates: Array<{ id: string; is_correct: boolean | null; marks_awarded: number | null; marking_method: "auto" | "rubric" | null; marked_at: string | null; marked_by: string | null }> = [];

  for (const q of questions ?? []) {
    const subject = Array.isArray(q.competencies) ? q.competencies[0] : q.competencies;
    const subjectId = (subject as { subject_id: string } | null)?.subject_id ?? "";
    const marks = Number(q.marks);
    const response = responseByQ.get(q.id);

    // No answer at all earns nothing, whatever the type. A blank essay is a
    // blank essay, and does not wait for an assessor.
    if (!response) {
      items.push({ competencyId: q.competency_id, subjectId, marks, marksAwarded: 0 });
      continue;
    }

    // A rubric mark a person has given stands.
    if (response.marking_method === "rubric" && response.marks_awarded !== null) {
      items.push({ competencyId: q.competency_id, subjectId, marks, marksAwarded: Number(response.marks_awarded) });
      continue;
    }

    const key = keyById.get(q.id);
    const parsedKey = parseAnswerKey(q.type as QuestionType, key?.answer ?? null);
    const result = markResponse(q.type as QuestionType, parsedKey, response.response as Json, marks, key?.partial_credit ?? false);

    if (result.status === "marked") {
      items.push({ competencyId: q.competency_id, subjectId, marks, marksAwarded: result.marksAwarded });
      if (
        response.marking_method !== "auto" ||
        response.marks_awarded === null ||
        Number(response.marks_awarded) !== result.marksAwarded ||
        response.is_correct !== result.isCorrect
      ) {
        updates.push({
          id: response.id,
          is_correct: result.isCorrect,
          marks_awarded: result.marksAwarded,
          marking_method: "auto",
          marked_at: new Date().toISOString(),
          marked_by: null,
        });
      }
    } else {
      items.push({ competencyId: q.competency_id, subjectId, marks, marksAwarded: null });
      (result.status === "needs_rubric" ? awaiting : unmarkable).push(q.id);
      if (response.marking_method !== null || response.marks_awarded !== null) {
        updates.push({ id: response.id, is_correct: null, marks_awarded: null, marking_method: null, marked_at: null, marked_by: null });
      }
    }
  }

  for (const u of updates) {
    const { id, ...fields } = u;
    const { error } = await admin.from("attempt_responses").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
  }

  const { data: benchmarkRows, error: bErr } = await admin.from("benchmarks").select("*").eq("is_active", true);
  if (bErr) throw new Error(bErr.message);
  const rules: BenchmarkRule[] = (benchmarkRows ?? []).map((b) => ({
    scope: b.scope as BenchmarkScope,
    scopeId: b.scope_id,
    gradeSortMin: b.grade_sort_min,
    gradeSortMax: b.grade_sort_max,
    bands: parseBenchmarkBands(b.bands),
  }));

  const scores = computeScores(items, rules, gradeSort);
  const { error: delErr } = await admin.from("attempt_scores").delete().eq("attempt_id", attemptId);
  if (delErr) throw new Error(delErr.message);
  if (scores.lines.length) {
    const { error: insErr } = await admin.from("attempt_scores").insert(
      scores.lines.map((l) => ({
        attempt_id: attemptId,
        scope: l.scope,
        scope_id: l.scopeId,
        raw: l.raw,
        max: l.max,
        percent: l.percent,
        band: l.band,
      }))
    );
    if (insErr) throw new Error(insErr.message);
  }

  const complete = scores.complete;
  const { data: updated, error: uErr } = await admin
    .from("attempts")
    .update({
      marking_status: complete ? "complete" : "awaiting_rubric",
      status: complete ? "marked" : "submitted",
    })
    .eq("id", attemptId)
    .select("*")
    .single();
  if (uErr || !updated) throw new Error(uErr?.message ?? "attempt update failed");

  return { attempt: updated, complete, awaiting, unmarkable };
}
