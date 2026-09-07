import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { AssessmentReportDocument } from "@/lib/documents/assessment-report-pdf";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { formatDateLong } from "@/lib/format-date";
import { NARRATIVE_SCHEMA } from "@/lib/profile/narrative";
import type { ComputedProfile } from "@/lib/profile/compute";
import { requireStaff } from "@/lib/staff/session";
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
    .select("id, application_id, launched_at, marking_status, applications(reference, child_first_name, child_last_name, campuses(name, descriptor, address), grades!applications_grade_id_fkey(name))")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return new Response("Not found", { status: 404 });
  const app = one(attempt.applications);
  if (!app) return new Response("Not found", { status: 404 });
  const campus = one(app.campuses);
  const grade = one(app.grades);

  const { data: profile } = await supabase
    .from("learning_profiles")
    .select("*")
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!profile) {
    return new Response("The report is ready once the sitting is fully marked and the learning profile has been generated. Try again in a few minutes.", {
      status: 409,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const narrative = NARRATIVE_SCHEMA.safeParse(profile.narrative);
  if (!narrative.success) return new Response("The learning profile is incomplete.", { status: 409 });

  const element = createElement(AssessmentReportDocument, {
    logoUrl: logoUrlFor(siteUrl()),
    letterhead: campus ?? null,
    studentName: `${app.child_first_name} ${app.child_last_name}`,
    firstName: app.child_first_name,
    gradeName: grade?.name ?? "",
    campusName: campus?.name ?? "",
    reference: app.reference,
    assessedOn: formatDateLong(attempt.launched_at),
    printedOn: formatDateLong(new Date()),
    computed: profile.computed as unknown as ComputedProfile,
    narrative: narrative.data,
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
