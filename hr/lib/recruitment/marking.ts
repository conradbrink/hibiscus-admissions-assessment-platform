import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { assessAiLikelihood, markAnswer, markCommunication } from "@/lib/ai/recruitment";
import { parseRubric } from "@/lib/questions/rubric";
import { loadApplicationBundle } from "@/lib/recruitment/bundle";
import { getHrSettings } from "@/lib/settings";

/**
 * The two AI jobs that run for every submitted application.
 *
 * Marking writes a band beside each answer and never over a person's band.
 * The integrity check writes a likelihood beside each answer and the
 * duplicate check's best match. Neither moves the application anywhere.
 *
 * A retryable provider failure throws, so the drain backs off and tries
 * again; anything else is left for a person and recorded on the event log.
 */

export type JobOutcome = { status: "done" } | { status: "skipped"; reason: string };

export async function markApplication(admin: AdminClient, applicationId: string): Promise<JobOutcome> {
  const settings = await getHrSettings(admin);
  if (!settings.aiMarkingEnabled) return { status: "skipped", reason: "AI marking is switched off" };
  const bundle = await loadApplicationBundle(admin, applicationId);
  if (!bundle || bundle.application.status !== "submitted") return { status: "skipped", reason: "application is not open" };

  const byQuestion = new Map(bundle.questions.map((q) => [q.id, q]));
  const skipped: string[] = [];
  for (const answer of bundle.answers) {
    if (answer.ai_band !== null) continue;
    const question = byQuestion.get(answer.vacancy_question_id);
    if (!question) continue;
    const rubric = parseRubric(question.rubric);
    const text = answer.answer_text.trim();
    if (!rubric) {
      skipped.push(`no rubric for "${question.prompt.slice(0, 40)}"`);
      continue;
    }
    // A blank or token answer earns band 0 without a model call.
    if (text.split(/\s+/).filter(Boolean).length < 5) {
      await saveMark(admin, answer.id, { band: 0, rationale: "No answer, or too short to mark.", evidence: [], model: "rule" });
      continue;
    }
    const result = await markAnswer({ prompt: question.prompt, rubric, answer: text });
    if (!result.ok) {
      if (result.retryable) throw new Error(`AI provider: ${result.reason}`);
      skipped.push(result.reason);
      continue;
    }
    await saveMark(admin, answer.id, result.mark);
  }

  if (bundle.application.communication_ai_band === null) {
    const written = bundle.answers
      .map((a) => ({ prompt: byQuestion.get(a.vacancy_question_id)?.prompt ?? "", answer: a.answer_text.trim() }))
      .filter((a) => a.answer.length > 0);
    if (written.length) {
      const result = await markCommunication(written);
      if (result.ok) {
        const { error } = await admin
          .from("hr_applications")
          .update({ communication_ai_band: result.mark.band, communication_ai_rationale: result.mark.rationale })
          .eq("id", applicationId);
        if (error) throw new Error(error.message);
      } else if (result.retryable) {
        throw new Error(`AI provider: ${result.reason}`);
      } else {
        skipped.push(result.reason);
      }
    }
  }

  if (skipped.length) {
    await admin.from("hr_application_events").insert({
      application_id: applicationId,
      kind: "ai_marking_incomplete",
      detail: { reasons: [...new Set(skipped)] } as Json,
      actor_type: "system",
    });
  }
  return { status: "done" };
}

async function saveMark(
  admin: AdminClient,
  answerId: string,
  mark: { band: number; rationale: string; evidence: string[]; model: string }
): Promise<void> {
  const { error } = await admin
    .from("hr_application_answers")
    .update({
      ai_band: mark.band,
      ai_rationale: mark.rationale,
      ai_evidence: mark.evidence as unknown as Json,
      ai_model: mark.model,
      ai_marked_at: new Date().toISOString(),
    })
    .eq("id", answerId)
    .is("ai_band", null);
  if (error) throw new Error(error.message);
}

export async function checkIntegrity(admin: AdminClient, applicationId: string): Promise<JobOutcome> {
  const settings = await getHrSettings(admin);
  if (!settings.aiIntegrityEnabled) return { status: "skipped", reason: "the AI-writing check is switched off" };
  const bundle = await loadApplicationBundle(admin, applicationId);
  if (!bundle || bundle.application.status === "draft" || bundle.application.status === "anonymised") {
    return { status: "skipped", reason: "application is not live" };
  }

  // The duplicate check needs no model, so it always runs.
  for (const answer of bundle.answers) {
    const { data: similar, error } = await admin.rpc("hr_similar_answers", { p_answer_id: answer.id, p_threshold: 0.8 });
    if (error) throw new Error(error.message);
    const best = similar?.[0];
    const { error: updateError } = await admin
      .from("hr_application_answers")
      .update({ duplicate_of_answer_id: best?.answer_id ?? null, duplicate_similarity: best ? Number(best.similarity.toFixed(3)) : null })
      .eq("id", answer.id);
    if (updateError) throw new Error(updateError.message);
  }

  const byQuestion = new Map(bundle.questions.map((q) => [q.id, q]));
  const checkable = bundle.answers.filter((a) => a.answer_text.trim().length >= 150 && a.ai_likelihood === null);
  if (!checkable.length) return { status: "done" };

  const result = await assessAiLikelihood(
    checkable.map((a) => ({ prompt: byQuestion.get(a.vacancy_question_id)?.prompt ?? "", answer: a.answer_text.trim() }))
  );
  if (!result.ok) {
    if (result.retryable) throw new Error(`AI provider: ${result.reason}`);
    // Not skipped silently: the applicant page shows "Not checked" for each
    // answer, and the event says why.
    await admin.from("hr_application_events").insert({
      application_id: applicationId,
      kind: "ai_integrity_not_checked",
      detail: { reason: result.reason } as Json,
      actor_type: "system",
    });
    return { status: "skipped", reason: result.reason };
  }
  const now = new Date().toISOString();
  for (const r of result.results) {
    const answer = checkable[r.index];
    if (!answer) continue;
    const { error } = await admin
      .from("hr_application_answers")
      .update({ ai_likelihood: r.likelihood, ai_likelihood_reasons: r.reasons as unknown as Json, ai_checked_at: now })
      .eq("id", answer.id);
    if (error) throw new Error(error.message);
  }
  return { status: "done" };
}
