import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { parseRubricBands } from "@/lib/assessment/bands";
import { AssessmentReportDocument, type WrittenItem } from "@/lib/documents/assessment-report-pdf";
import { formatDateLong } from "@/lib/format-date";
import { BANNED_TERMS, NARRATIVE_SCHEMA } from "@/lib/profile/narrative";
import type { ComputedProfile } from "@/lib/profile/compute";
import { requireStaff } from "@/lib/staff/session";
import type { Json } from "@/lib/supabase/types";
import { siteUrl } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The printable assessment report for one sitting, for the assessor to
 * take into the meeting with the parent. Read through the staff client, so
 * row-level security decides what this person may see; rendered from the
 * stored profile and marks; nothing is written.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ attemptId: string }> }): Promise<Response> {
  const { attemptId } = await ctx.params;
  const { supabase } = await requireStaff("applications.read");

  const { data: attempt } = await supabase
    .from("attempts")
    .select("id, application_id, form_id, launched_at, marking_status, applications(reference, child_first_name, child_last_name, campuses(name), grades!applications_grade_id_fkey(name))")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return new Response("Not found", { status: 404 });
  const app = one(attempt.applications);
  if (!app) return new Response("Not found", { status: 404 });
  const campus = one(app.campuses);
  const grade = one(app.grades);

  const [{ data: profile }, { data: questions }, { data: responses }] = await Promise.all([
    supabase.from("learning_profiles").select("*").eq("attempt_id", attemptId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("form_questions").select("id, section_title, section_position, position, stem, marks, type, rubric_snapshot").eq("form_id", attempt.form_id).eq("type", "extended_text").order("section_position").order("position"),
    supabase.from("attempt_responses").select("form_question_id, marks_awarded, marking_method, ai_suggestion").eq("attempt_id", attemptId),
  ]);
  if (!profile) {
    return new Response("The report is ready once the sitting is fully marked and the learning profile has been generated. Try again in a few minutes.", {
      status: 409,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const narrative = NARRATIVE_SCHEMA.safeParse(profile.narrative);
  if (!narrative.success) return new Response("The learning profile is incomplete.", { status: 409 });

  const byQuestion = new Map((responses ?? []).map((r) => [r.form_question_id, r]));
  const written: WrittenItem[] = [];
  for (const q of questions ?? []) {
    const r = byQuestion.get(q.id);
    if (!r || r.marks_awarded === null) continue;
    const rubric = q.rubric_snapshot && typeof q.rubric_snapshot === "object" && !Array.isArray(q.rubric_snapshot) ? (q.rubric_snapshot as { bands?: Json }) : null;
    const bands = parseRubricBands(rubric?.bands ?? null);
    const suggestion = r.ai_suggestion && typeof r.ai_suggestion === "object" && !Array.isArray(r.ai_suggestion) ? (r.ai_suggestion as { band?: string; rationale?: string; applied?: boolean }) : null;
    // The marker's note is shown only when it is the note behind the mark that
    // stands, and only when it says nothing a parent should not read.
    const note = r.marking_method === "ai" && suggestion?.applied && typeof suggestion.rationale === "string" && !BANNED_TERMS.some((re) => re.test(suggestion.rationale ?? "")) ? suggestion.rationale : null;
    const bandLabel = suggestion?.band ? (bands.find((b) => b.key === suggestion.band)?.label ?? null) : null;
    written.push({
      section: q.section_title,
      question: shorten(q.stem),
      marksAwarded: Number(r.marks_awarded),
      marksAvailable: Number(q.marks),
      bandLabel: r.marking_method === "ai" ? bandLabel : null,
      note,
    });
  }

  const element = createElement(AssessmentReportDocument, {
    logoUrl: `${siteUrl()}/brand/hibiscus-logo.png`,
    studentName: `${app.child_first_name} ${app.child_last_name}`,
    firstName: app.child_first_name,
    gradeName: grade?.name ?? "",
    campusName: campus?.name ?? "",
    reference: app.reference,
    assessedOn: formatDateLong(attempt.launched_at),
    printedOn: formatDateLong(new Date()),
    computed: profile.computed as unknown as ComputedProfile,
    narrative: narrative.data,
    written,
  }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="hibiscus-assessment-report-${app.reference}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

/** The question without its housekeeping: no marks tag, no instructions to the child about typing, one line. */
function shorten(stem: string): string {
  const firstLine = stem.split("\n").map((l) => l.trim()).filter(Boolean);
  let text = firstLine.length > 1 && /^(Part|Section) [ABC]\.\s*$/.test(firstLine[0]) ? firstLine.slice(1).join(" ") : firstLine.join(" ");
  text = text
    .replace(/^(Part|Section) [ABC](,\s*question \d+)?\.\s*/i, "")
    .replace(/\s*\(\d+ marks?\)\s*$/i, "")
    .replace(/\s*Type the number only\.?/i, "")
    .replace(/You have five minutes to write this answer\.\s*/i, "");
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}
