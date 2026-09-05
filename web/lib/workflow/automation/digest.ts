import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { sendStaffEmail } from "@/lib/email/send";
import { formatDateLong } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/tokens";
import type { JobRow } from "@/lib/supabase/types";
import { digestHasContent, digestKey, gaboroneNow } from "@/lib/workflow/automation/rules";
import { enqueueJobs } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

/**
 * One morning email per campus team: the counts that need attention, no
 * applicant names, no links to applicants. Queued once per campus per day
 * by the drain after the digest hour; sent to every active member of staff
 * who may see the campus and has not turned the digest off.
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

  const recipients = await digestRecipients(admin, p.campus_id);
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
 * Who gets a campus's digest: active staff with the digest on who are
 * either assigned to the campus or unrestricted (no campus rows and no
 * campus-scoped role). Mirrors `can_access_campus`.
 */
export async function digestRecipients(admin: AdminClient, campusId: string): Promise<Array<{ id: string; full_name: string; email: string }>> {
  const [{ data: staff }, { data: assignments }, { data: scopedRoles }] = await Promise.all([
    admin.from("staff_profiles").select("id, full_name, email").eq("is_active", true).eq("digest_enabled", true),
    admin.from("staff_campuses").select("staff_id, campus_id"),
    admin.from("staff_roles").select("staff_id, roles!inner(campus_scoped)").eq("roles.campus_scoped", true),
  ]);
  const assigned = new Map<string, Set<string>>();
  for (const a of assignments ?? []) assigned.set(a.staff_id, (assigned.get(a.staff_id) ?? new Set()).add(a.campus_id));
  const scoped = new Set((scopedRoles ?? []).map((r) => r.staff_id));
  return (staff ?? []).filter((s) => {
    const mine = assigned.get(s.id);
    if (mine) return mine.has(campusId);
    return !scoped.has(s.id);
  });
}
