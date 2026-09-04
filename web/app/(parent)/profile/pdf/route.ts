import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { redirect } from "next/navigation";
import { createElement, type ReactElement } from "react";
import { loadApplicationGraph } from "@/lib/applications";
import { ProfileDocument } from "@/lib/documents/profile-pdf";
import { formatDateLong } from "@/lib/format-date";
import { loadVisibleProfile } from "@/lib/profile/load";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rendered on demand from the stored snapshot; nothing is written anywhere. */
export async function GET(): Promise<Response> {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const visible = await loadVisibleProfile(admin, graph.application);
  if (!visible) return new Response("Not found", { status: 404 });

  // react-pdf types renderToBuffer's argument as a <Document> element; a
  // component that returns one is the same thing at runtime.
  const element = createElement(ProfileDocument, {
    studentName: `${graph.application.child_first_name} ${graph.application.child_last_name}`,
    gradeName: graph.grade.name,
    campusName: graph.campus.name,
    reference: graph.application.reference,
    generatedOn: formatDateLong(visible.profile.published_at ?? visible.profile.created_at),
    computed: visible.computed,
    narrative: visible.narrative,
  }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  const filename = `hibiscus-learning-profile-${graph.application.reference}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
