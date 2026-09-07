import "server-only";
import { loadApplicationGraph, type ApplicationGraph } from "@/lib/applications";
import { applicableRequirements, liveDocument } from "@/lib/registration/completeness";
import { loadRegistrationBundle, type RegistrationBundle } from "@/lib/registration/load";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { DocumentRequirementRow } from "@/lib/supabase/types";
import { readParentSession } from "@/lib/tokens/server";

/**
 * The checks every parent upload passes, whichever way the bytes travel:
 * a live session, a requirement that applies to the child's grade, a
 * registration that is open (or a rejected document being replaced), and
 * the rate limit. Returns the pieces the route needs or the error code the
 * page shows.
 */
export type UploadContext = {
  admin: AdminClient;
  graph: ApplicationGraph;
  bundle: RegistrationBundle;
  requirement: DocumentRequirementRow;
};

export async function guardParentUpload(requirementCode: string, opts: { rateLimit?: boolean } = {}): Promise<{ ok: true; ctx: UploadContext } | { ok: false; code: string; status: number }> {
  const session = await readParentSession();
  if (!session) return { ok: false, code: "expired", status: 401 };
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) return { ok: false, code: "expired", status: 401 };
  const bundle = await loadRegistrationBundle(admin, graph);
  const requirement = applicableRequirements(bundle.requirements, graph.grade.sort_order).find((q) => q.code === requirementCode);
  if (!requirement) return { ok: false, code: "unknown_requirement", status: 400 };
  const status = graph.application.status;
  const existing = liveDocument(bundle.documents, requirementCode);
  const rejected = existing?.review_status === "rejected" || existing?.scan_status === "infected";
  if (status !== "registration_incomplete" && !((status === "registration_complete" || status === "enrolled") && rejected)) {
    return { ok: false, code: "not_open", status: 409 };
  }
  if (opts.rateLimit !== false) {
    const verdict = await enforceRateLimit(admin, LIMITS.documentUpload, graph.application.id);
    if (!verdict.ok) return { ok: false, code: "busy", status: 429 };
  }
  return { ok: true, ctx: { admin, graph, bundle, requirement } };
}
