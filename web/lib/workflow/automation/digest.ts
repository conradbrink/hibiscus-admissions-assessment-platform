import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { sendStaffEmail } from "@/lib/email/send";
import { formatDateLong } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/tokens";
import type { JobRow } from "@/lib/supabase/types";
import { DIGEST_PERMISSION, chooseDigestRecipients, digestHasContent, digestKey, gaboroneNow } from "@/lib/workflow/automation/rules";
import { enqueueJobs } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

/**
 * One morning email per campus team: the counts that need attention, no
 * applicant names, no links to applicants. Queued once per campus per day
 * by the drain after the digest hour; sent to every active member of staff
 * who may read admissions, may see the campus, and has not turned the digest
 * off.
 */

export async function queueDigests(admin: AdminClient, now = new Date()): Promise<number> {
  const settings = await getSettings(admin);
  if (!settings.digestEnabled) return 0;
  const { date, hour } = gaboroneNow(now);
  if (hour < settings.digestHour) return 0;
  const { data: campuses } = await admin.from("campuses").select("id").eq("is_active", true);
  return enqueueJobs(
    admin,
    (campuses ?? []).map((c) => ({ type: "staff_digest", applicationId: null, idempotencyKey: digestKey(c.id, date), payload: { campus_id: c.id, date } }))
  );
}

type Counts = Record<string, number>;

export async function staffDigestHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { campus_id?: string; date?: string };
  if (!p.campus_id || !p.date) return { outcome: "failed", error: "staff_digest job missing campus_id or date", retryable: false };
  const settings = await getSettings(admin);
  if (!settings.digestEnabled) return { outcome: "skipped", reason: "digest switched off" };

  const [{ data: campus }, { data: countsRaw, error: cErr }] = await Promise.all([
    admin.from("campuses").select("id, name").eq("id", p.campus_id).maybeSingle(),
    admin.rpc("campus_dashboard_counts", { p_campus_id: p.campus_id }),
  ]);
  if (!campus) return { outcome: "skipped", reason: "campus missing" };
  if (cErr) return { outcome: "failed", error: cErr.message, retryable: true };
  const counts = (countsRaw ?? {}) as Counts;
  if (!digestHasContent(counts)) return { outcome: "skipped", reason: "nothing to report" };

  let recipients: Awaited<ReturnType<typeof digestRecipients>>;
  try {
    recipients = await digestRecipients(admin, p.campus_id);
  } catch (e) {
    // Not "nobody to send to": a read that failed is retried, not taken as
    // an empty list that quietly drops the morning's email.
    return { outcome: "failed", error: e instanceof Error ? e.message : "could not read the digest recipients", retryable: true };
  }
  if (!recipients.length) return { outcome: "skipped", reason: "nobody to send to" };

  const variables = {
    campus: campus.name,
    date: formatDateLong(`${p.date}T00:00:00+02:00`),
    assessments_today: String(counts.assessments_today ?? 0),
    awaiting_marking: String(counts.awaiting_marking ?? 0),
    tasks_overdue: String(counts.tasks_overdue ?? 0),
    offers_to_approve: String(counts.offers_to_approve ?? 0),
    offers_expiring: String(counts.offers_expiring ?? 0),
    payments_overdue: String(counts.payments_overdue ?? 0),
    documents_missing: String(counts.documents_missing ?? 0),
    enrolments_to_confirm: String(counts.enrolments_to_confirm ?? 0),
    waitlist_places: String(counts.waitlist_places ?? 0),
    parent_replies: String(counts.parent_replies ?? 0),
    console_link: `${siteUrl()}/staff`,
  };

  let failures = 0;
  for (const r of recipients) {
    const result = await sendStaffEmail(admin, {
      staffId: r.id,
      templateKey: "staff_digest",
      variables: { ...variables, staff_first_name: r.full_name.split(" ")[0] },
      idempotencyKey: `${job.idempotency_key}:${r.id}`,
    });
    if (result.status === "failed") failures += 1;
  }
  return failures ? { outcome: "failed", error: `${failures} of ${recipients.length} digests failed`, retryable: true } : { outcome: "done" };
}

/**
 * Who gets a campus's digest: active staff with the digest on who may read
 * admissions and may see the campus (see `chooseDigestRecipients`). Read
 * with the service role, so the permission is resolved here the way
 * `has_permission` resolves it: any role carrying the permission or `admin`.
 * Throws when a read fails, so the job is retried.
 */
export async function digestRecipients(admin: AdminClient, campusId: string): Promise<Array<{ id: string; full_name: string; email: string }>> {
  const [staff, assignments, scopedRoles, grants] = await Promise.all([
    admin.from("staff_profiles").select("id, full_name, email").eq("is_active", true).eq("digest_enabled", true),
    admin.from("staff_campuses").select("staff_id, campus_id"),
    admin.from("staff_roles").select("staff_id, roles!inner(campus_scoped)").eq("roles.campus_scoped", true),
    admin.from("role_permissions").select("role_id").in("permission_code", [DIGEST_PERMISSION, "admin"]),
  ]);
  for (const r of [staff, assignments, scopedRoles, grants]) if (r.error) throw new Error(r.error.message);
  const roleIds = [...new Set((grants.data ?? []).map((g) => g.role_id))];
  let readers: string[] = [];
  if (roleIds.length) {
    const holders = await admin.from("staff_roles").select("staff_id").in("role_id", roleIds);
    if (holders.error) throw new Error(holders.error.message);
    readers = (holders.data ?? []).map((h) => h.staff_id);
  }
  return chooseDigestRecipients(staff.data ?? [], campusId, {
    assignments: assignments.data ?? [],
    campusScoped: (scopedRoles.data ?? []).map((r) => r.staff_id),
    admissionsReaders: readers,
  });
}
