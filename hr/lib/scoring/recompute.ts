import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { judgeAnswer } from "@/lib/integrity/signals";
import { loadApplicationBundle, type ApplicationBundle } from "@/lib/recruitment/bundle";
import { summariseTenure } from "@/lib/recruitment/tenure";
import { scoreApplication, type ScoreInput, type ScoreResult } from "@/lib/scoring/score";
import { getHrSettings, ScoringWeightsSchema } from "@/lib/settings";

/**
 * Builds the scoring input from an application's rows. Kept apart from the
 * write so the staff page can show exactly what the job stored.
 */
export function scoreInputFrom(bundle: ApplicationBundle, fallbackWeights: ScoreInput["weights"], today = new Date()): ScoreInput {
  const frozen = ScoringWeightsSchema.safeParse(bundle.vacancy.scoring_weights);
  const answersByQuestion = new Map(bundle.answers.map((a) => [a.vacancy_question_id, a]));
  const recentEmployerReferees = new Set(bundle.referees.filter((r) => r.is_most_recent_employer).map((r) => r.id));
  const requestById = new Map(bundle.requests.map((r) => [r.id, r]));

  return {
    today,
    country: bundle.campus.country,
    phase: bundle.vacancy.phase,
    isCitizen: bundle.application.is_citizen,
    qualifications: bundle.qualifications,
    compliance: bundle.compliance,
    tenure: summariseTenure(bundle.employment, today),
    answers: bundle.questions.map((q) => {
      const a = answersByQuestion.get(q.id);
      const verdict = a
        ? judgeAnswer({
            text: a.answer_text,
            behaviour: (a.integrity ?? {}) as Record<string, number>,
            model: a.ai_likelihood,
            duplicateSimilarity: a.duplicate_similarity,
          })
        : null;
      return {
        competency: q.competency,
        answered: !!a && a.answer_text.trim().length > 0,
        aiBand: a?.ai_band ?? null,
        humanBand: a?.human_band ?? null,
        integrity: verdict?.level ?? "low",
      };
    }),
    communication: { aiBand: bundle.application.communication_ai_band, humanBand: bundle.application.communication_human_band },
    references: {
      requested: bundle.requests.filter((r) => r.status !== "declined").length,
      outstanding: bundle.requests.filter((r) => ["pending", "sent", "opened"].includes(r.status)).length,
      responses: bundle.responses.map((resp) => {
        const request = requestById.get(resp.request_id);
        return {
          ratings: (resp.ratings ?? {}) as Record<string, number>,
          recommendation: resp.recommendation,
          wouldReemploy: resp.would_reemploy,
          concern: resp.concern,
          fromMostRecentEmployer: !!request && recentEmployerReferees.has(request.referee_id),
        };
      }),
    },
    weights: frozen.success ? frozen.data : fallbackWeights,
  };
}

/** Recomputes and stores a new score snapshot. Returns null for an application that is not live. */
export async function recomputeScore(admin: AdminClient, applicationId: string): Promise<ScoreResult | null> {
  const bundle = await loadApplicationBundle(admin, applicationId);
  if (!bundle || bundle.application.status === "draft" || bundle.application.status === "anonymised") return null;
  const settings = await getHrSettings(admin);
  const input = scoreInputFrom(bundle, settings.scoringWeights);
  const result = scoreApplication(input);

  const { data: last } = await admin
    .from("hr_application_scores")
    .select("version")
    .eq("application_id", applicationId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from("hr_application_scores").insert({
    application_id: applicationId,
    version: (last?.version ?? 0) + 1,
    total: result.total,
    available: result.available,
    breakdown: result.sections as unknown as Json,
    // The inputs that matter for "why this number", without personal data.
    inputs: {
      weights: input.weights,
      tenure: { averageMonths: input.tenure.averageMonths, schoolMonths: input.tenure.schoolMonths, totalMonths: input.tenure.totalMonths },
      answers: input.answers.map((a) => ({ competency: a.competency, ai: a.aiBand, human: a.humanBand, integrity: a.integrity })),
      references: { requested: input.references.requested, outstanding: input.references.outstanding, received: input.references.responses.length },
    } as unknown as Json,
    flags: result.flags.map((f) => f.code),
  });
  if (error) throw new Error(error.message);

  const { error: updateError } = await admin
    .from("hr_applications")
    .update({ score_total: result.total, score_available: result.available, score_flags: result.flags.map((f) => f.code) })
    .eq("id", applicationId);
  if (updateError) throw new Error(updateError.message);
  return result;
}
