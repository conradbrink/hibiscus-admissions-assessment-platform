import "server-only";
import { getAiProvider } from "@/lib/ai/provider";
import { computeProfile, type CompetencyMeta, type SubjectMeta } from "@/lib/profile/compute";
import {
  fallbackNarrative,
  NARRATIVE_SCHEMA,
  narrativeInput,
  narrativeSystemPrompt,
  PROMPT_VERSION,
  validateNarrative,
  type Narrative,
} from "@/lib/profile/narrative";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { BenchmarkBand, BenchmarkScope, Json } from "@/lib/supabase/types";
import { commit, SYSTEM_ACTOR } from "@/lib/workflow/engine";

/**
 * Builds and publishes a learning profile for a marked attempt.
 *
 * Compute → (AI narrative → validate) → else fallback → persist. What
 * reaches the AI is pseudonymised: a first name, a grade name, competency
 * names and the numbers. Never a surname, date of birth, contact detail or
 * anything a parent typed. Idempotent: re-running replaces the profile.
 */
export async function generateLearningProfile(
  admin: AdminClient,
  attemptId: string
): Promise<{ source: "ai" | "fallback"; validation: "passed" | "failed" | "not_run" }> {
  const { data: attempt, error: aErr } = await admin.from("attempts").select("*").eq("id", attemptId).single();
  if (aErr || !attempt) throw new Error(aErr?.message ?? "attempt missing");
  if (attempt.marking_status !== "complete") throw new Error("Attempt is not fully marked");

  const [{ data: app }, { data: scores }, { data: competencies }, { data: subjects }, settings] = await Promise.all([
    admin
      .from("applications")
      .select("id, status, child_first_name, child_last_name, grades!applications_grade_id_fkey(name)")
      .eq("id", attempt.application_id)
      .single(),
    admin.from("attempt_scores").select("scope, scope_id, percent, band").eq("attempt_id", attemptId),
    admin.from("competencies").select("id, name, subject_id, focus_label, reportable, sort_order"),
    admin.from("subjects").select("id, name, sort_order"),
    getSettings(admin),
  ]);
  if (!app) throw new Error("application missing");
  const grade = Array.isArray(app.grades) ? app.grades[0] : app.grades;
  const gradeName = (grade as { name: string } | null)?.name ?? "";

  const computed = computeProfile(
    (scores ?? []).map((s) => ({
      scope: s.scope as BenchmarkScope,
      scopeId: s.scope_id,
      percent: Number(s.percent),
      band: s.band as BenchmarkBand,
    })),
    (competencies ?? []).map<CompetencyMeta>((c) => ({
      id: c.id,
      name: c.name,
      subjectId: c.subject_id,
      focusLabel: c.focus_label,
      reportable: c.reportable,
      sortOrder: c.sort_order,
    })),
    (subjects ?? []).map<SubjectMeta>((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order }))
  );

  const firstName = app.child_first_name;
  const fallback = fallbackNarrative(computed, firstName);
  let narrative: Narrative = fallback;
  let source: "ai" | "fallback" = "fallback";
  let model: string | null = null;
  let validation: "passed" | "failed" | "not_run" = "not_run";
  let errors: Json | null = null;

  if (settings.aiNarrativeEnabled) {
    const provider = await getAiProvider();
    const result = await provider.generateStructured({
      schema: NARRATIVE_SCHEMA,
      system: narrativeSystemPrompt(),
      input: narrativeInput(computed, firstName, gradeName),
      devOutput: () => fallback,
    });
    if (result.ok) {
      const problems = validateNarrative(result.output, computed, { firstName, lastName: app.child_last_name });
      model = result.model;
      if (problems.length === 0) {
        narrative = result.output;
        source = "ai";
        validation = "passed";
      } else {
        validation = "failed";
        errors = problems as unknown as Json;
      }
    } else if (result.retryable) {
      // Let the job retry; a transient failure should not publish the fallback.
      throw new Error(`AI provider: ${result.error ?? result.reason}`);
    } else {
      errors = [{ kind: result.reason, detail: result.error ?? "" }] as unknown as Json;
    }
  }

  const { error: upErr } = await admin.from("learning_profiles").upsert(
    {
      attempt_id: attemptId,
      application_id: app.id,
      computed: computed as unknown as Json,
      narrative: narrative as unknown as Json,
      narrative_source: source,
      ai_model: model,
      prompt_version: PROMPT_VERSION,
      validation_status: validation,
      validation_errors: errors,
      published_at: new Date().toISOString(),
    },
    { onConflict: "attempt_id" }
  );
  if (upErr) throw new Error(upErr.message);

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: {
      type: "profile.generated",
      summary:
        source === "ai"
          ? "Learning profile generated (AI narrative, validated)"
          : validation === "failed"
            ? "Learning profile generated (AI narrative failed validation; standard wording used)"
            : "Learning profile generated (standard wording)",
      payload: { attempt_id: attemptId, source, validation, model },
    },
    actor: SYSTEM_ACTOR,
  });

  return { source, validation };
}
