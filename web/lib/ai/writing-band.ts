import "server-only";
import { z } from "zod";
import { getAiProvider } from "@/lib/ai/provider";
import { parseRubricBands } from "@/lib/assessment/bands";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

/**
 * Suggests a rubric band for one piece of writing. The suggestion is stored
 * on the response for the assessor to see; it never awards marks and the
 * marking pipeline never reads it. What the model sees: the question, the
 * rubric's band descriptors, and the text the child wrote — no name.
 */
export async function suggestWritingBand(
  admin: AdminClient,
  attemptId: string,
  formQuestionId: string
): Promise<"suggested" | "skipped"> {
  const [{ data: q }, { data: r }] = await Promise.all([
    admin.from("form_questions").select("stem, rubric_snapshot, marks").eq("id", formQuestionId).single(),
    admin
      .from("attempt_responses")
      .select("id, response, marks_awarded")
      .eq("attempt_id", attemptId)
      .eq("form_question_id", formQuestionId)
      .maybeSingle(),
  ]);
  if (!q || !r) return "skipped";
  if (r.marks_awarded !== null) return "skipped"; // already marked by a person
  const rubric = q.rubric_snapshot && typeof q.rubric_snapshot === "object" && !Array.isArray(q.rubric_snapshot)
    ? (q.rubric_snapshot as { bands?: Json })
    : null;
  const bands = parseRubricBands(rubric?.bands ?? null);
  if (bands.length < 2) return "skipped";
  const text = (r.response as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || text.trim().length < 10) return "skipped";

  const keys = bands.map((b) => b.key) as [string, ...string[]];
  const schema = z.object({ band: z.enum(keys), rationale: z.string().max(400) });
  const provider = await getAiProvider();
  const result = await provider.generateStructured({
    schema,
    system: [
      "You are helping a teacher mark a child's short piece of writing against a rubric.",
      "Choose the single band whose descriptor best fits the writing, and give one sentence of rationale that quotes or points to evidence in the text.",
      "Judge only the writing against the descriptors. Do not comment on the child, their ability, or anything outside the text.",
    ].join("\n"),
    input: JSON.stringify(
      {
        task: q.stem,
        bands: bands.map((b) => ({ key: b.key, label: b.label, descriptor: b.descriptor })),
        writing: text.slice(0, 6000),
      },
      null,
      2
    ),
    maxTokens: 2000,
    devOutput: () => ({ band: bands[Math.floor(bands.length / 2)].key, rationale: "Development adapter: middle band." }),
  });
  if (!result.ok) {
    if (result.retryable) throw new Error(`AI provider: ${result.error ?? result.reason}`);
    return "skipped";
  }
  const { error } = await admin
    .from("attempt_responses")
    .update({ ai_suggestion: { band: result.output.band, rationale: result.output.rationale, model: result.model } })
    .eq("id", r.id)
    .is("marks_awarded", null);
  if (error) throw new Error(error.message);
  return "suggested";
}
