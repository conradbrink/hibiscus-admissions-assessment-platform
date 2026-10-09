import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrApplicationRow } from "@/lib/supabase/types";
import type { Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { markHired } from "@/lib/recruitment/engine";

/**
 * Hiring a shortlisted applicant. Marks the application hired (which also
 * takes it out of retention: a hired applicant's record is kept). The
 * employee record is created from it once the employee tables exist.
 */
export async function hireApplicant(admin: AdminClient, actor: Actor, app: HrApplicationRow, opts: { startDate: string }): Promise<string> {
  if (app.status !== "submitted" || app.stage !== "shortlisted") throw new HrError("Only a shortlisted applicant can be hired.");
  void opts;
  await markHired(admin, actor, app);
  return app.id;
}
