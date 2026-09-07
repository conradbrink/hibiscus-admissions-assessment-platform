import "server-only";
import { z } from "zod";
import { getAiProvider } from "@/lib/ai/provider";
import { markWithoutModel, marksForBand } from "@/lib/assessment/ai-marking";
import { parseRubricBands } from "@/lib/assessment/bands";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

/**
 * Marks one written answer against its rubric and records the mark, with
 * the band and a one-sentence rationale beside it, as marking_method 'ai'.
 * A person's mark is never overwritten; a blank or token answer earns the
 * lowest band without a model call. What the model sees: the question, the
 * band descriptors (which carry the school's model answer), and the text
 * the child wrote. Never the child's name.
 *
 * Returns "skipped", with the reason, when the answer cannot be marked this
 * way (no rubric, already marked by a person, the provider refused or
 * failed), so the caller can hand the attempt to a person instead and the
 * job log says why.
 */
export type AutoMarkResult = { status: "marked" } | { status: "skipped"; reason: string };

export async function autoMarkResponse(admin: AdminClient, attemptId: string, formQuestionId: string): Promise<AutoMarkResult> {
  const skipped = (reason: string): AutoMarkResult => ({ status: "skipped", reason });
  const [{ data: q }, { data: r }] = await Promise.all([
    admin.from("form_questions").select("stem, rubric_snapshot, marks").eq("id", formQuestionId).single(),
    admin
      .from("attempt_responses")
      .select("id, response, marks_awarded, marking_method")
      .eq("attempt_id", attemptId)
      .eq("form_question_id", formQuestionId)
      .maybeSingle(),
  ]);
  if (!q || !r) return skipped("question or response missing");
  if (r.marking_method === "rubric" && r.marks_awarded !== null) return skipped("already marked by a person");
  if (r.marking_method === "ai" && r.marks_awarded !== null) return { status: "marked" }; // already done

  const rubric = q.rubric_snapshot && typeof q.rubric_snapshot === "object" && !Array.isArray(q.rubric_snapshot)
    ? (q.rubric_snapshot as { bands?: Json })
    : null;
  const bands = parseRubricBands(rubric?.bands ?? null);
  if (bands.length < 2) return skipped("the question has no rubric");
  const text = (r.response as { text?: unknown } | null)?.text;
  const maxMarks = Number(q.marks);

  let chosen = markWithoutModel(text, bands);
  let model = "rule";
  if (!chosen) {
    const keys = bands.map((b) => b.key) as [string, ...string[]];
    const schema = z.object({ band: z.enum(keys), rationale: z.string().max(400) });
    const provider = await getAiProvider();
    if (provider.name === "dev") return skipped("no real AI provider is configured"); // the placeholder adapter must never mark a child
    const result = await provider.generateStructured({
      schema,
      system: [
        "You are marking one answer from a school entrance test against a marking rubric.",
        "Each band's descriptor states what earns that band; where it quotes an expected answer, treat it as the marking key and accept the same meaning in the child's own words.",
        "Choose the single band whose descriptor the answer meets in full. When an answer sits between bands, choose the lower one.",
        "Give one sentence of rationale that points to evidence in the answer. Judge only the answer against the descriptors; say nothing about the child.",
      ].join("\n"),
      input: JSON.stringify(
        {
          question: q.stem,
          bands: bands.map((b) => ({ key: b.key, marks: b.min_marks, label: b.label, descriptor: b.descriptor })),
          answer: String(text).slice(0, 6000),
        },
        null,
        2
      ),
      maxTokens: 2000,
      devOutput: () => ({ band: bands[0].key, rationale: "Development adapter." }),
    });
    if (!result.ok) {
      if (result.retryable) throw new Error(`AI provider: ${result.error ?? result.reason}`);
      return skipped(`AI provider ${result.reason}: ${result.error ?? "no detail"}`);
    }
    chosen = { band: result.output.band, rationale: result.output.rationale };
    model = result.model;
  }

  const marks = marksForBand(bands, chosen.band, maxMarks);
  if (marks === null) return skipped(`the model chose a band the rubric does not have (${chosen.band})`);
  const { error } = await admin
    .from("attempt_responses")
    .update({
      marks_awarded: marks,
      is_correct: null,
      marking_method: "ai",
      marked_by: null,
      marked_at: new Date().toISOString(),
      ai_suggestion: { band: chosen.band, rationale: chosen.rationale, model, applied: true },
    })
    .eq("id", r.id)
    .is("marks_awarded", null);
  if (error) throw new Error(error.message);
  return { status: "marked" };
}
