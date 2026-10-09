import "server-only";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { loadDraftFor } from "@/lib/applicant/scope";
import { readApplicantSession } from "@/lib/tokens/server";

/** What both upload routes check first: a verified applicant, an open draft, quota left. */
export async function guardApplicantUpload(): Promise<
  { ok: true; admin: AdminClient; applicationId: string } | { ok: false; code: string; status: number }
> {
  const session = await readApplicantSession();
  if (!session) return { ok: false, code: "session", status: 401 };
  const admin = createAdminClient();
  const draft = await loadDraftFor(admin, session);
  if (!draft.ok) return { ok: false, code: draft.reason, status: 409 };
  const verdict = await enforceRateLimit(admin, LIMITS.documentUpload, `app:${session.applicationId}`);
  if (!verdict.ok) return { ok: false, code: "busy", status: 429 };
  return { ok: true, admin, applicationId: draft.application.id };
}
