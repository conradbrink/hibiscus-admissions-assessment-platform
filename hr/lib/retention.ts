import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { removeApplicationObjects } from "@/lib/documents/storage";

/**
 * The retention sweep, run by the drain once a day. The only caller of
 * `hr_anonymise_applicant()`. Files go first, because the database function
 * cannot touch storage; then the row's personal data.
 *
 * Unfinished drafts past their expiry, and unsuccessful or withdrawn
 * applicants past the retention period (longer with talent-pool consent),
 * are anonymised. A hired applicant is never touched here.
 */
export async function runRetention(admin: AdminClient, limit = 50): Promise<{ anonymised: number; errors: string[] }> {
  const { data, error } = await admin
    .from("hr_applications")
    .select("id")
    .lte("retention_due_at", new Date().toISOString())
    .in("status", ["draft", "withdrawn", "submitted"])
    .limit(limit);
  if (error) throw new Error(error.message);
  const errors: string[] = [];
  let anonymised = 0;
  for (const row of data ?? []) {
    // A submitted application is only due when it was marked unsuccessful;
    // re-check, so a card moved back to Review an hour ago is safe.
    const { data: app } = await admin.from("hr_applications").select("status, stage, retention_due_at").eq("id", row.id).single();
    if (!app?.retention_due_at || (app.status === "submitted" && app.stage !== "unsuccessful")) continue;
    try {
      await removeApplicationObjects(admin, row.id);
      const { error: rpcError } = await admin.rpc("hr_anonymise_applicant", { p_application_id: row.id });
      if (rpcError) throw new Error(rpcError.message);
      anonymised++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { anonymised, errors };
}
