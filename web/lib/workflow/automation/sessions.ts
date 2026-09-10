import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { planSessions, schoolDate, type ScheduleRule } from "@/lib/workflow/automation/schedule";

/**
 * Keeps a published assessment sitting and a school visit on the books at
 * each of the school's sitting times, every weekday at every active campus,
 * a few weeks ahead, skipping the dates under Set up → School holidays.
 * Runs from the job drain; idempotent, because it only adds what
 * `planSessions` says is missing, and a time that already has a session of
 * that kind at that campus (made by hand or by an earlier run) is left
 * alone. Deleting or unpublishing a session by hand therefore keeps that
 * slot free only until the next run adds one back; to close a day, add a
 * closure.
 */
export async function ensureWeekdaySessions(admin: AdminClient, now = new Date()): Promise<number> {
  const settings = await getSettings(admin);
  if (!settings.autoSessionsEnabled) return 0;

  const today = schoolDate(now);
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + (settings.autoSessionsWeeksAhead * 7 + 1) * 86_400_000).toISOString();
  const [{ data: campuses, error: cErr }, { data: closures, error: clErr }, { data: existing, error: sErr }] = await Promise.all([
    admin.from("campuses").select("id").eq("is_active", true),
    admin.from("school_closures").select("campus_id, starts_on, ends_on").gte("ends_on", today),
    admin
      .from("sessions")
      .select("campus_id, kind, starts_at")
      .gte("starts_at", new Date(now.getTime() - 86_400_000).toISOString())
      .lte("starts_at", horizon)
      .limit(5000),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (clErr) throw new Error(clErr.message);
  if (sErr) throw new Error(sErr.message);

  // Each kind at each of its times: three sittings and three visits a day,
  // rather than one of each, which is what the school asks families to choose
  // between.
  const rules: ScheduleRule[] = [
    ...settings.autoAssessmentStarts.map((startMinutes): ScheduleRule => ({
      kind: "assessment",
      startMinutes,
      durationMinutes: settings.autoAssessmentDurationMinutes,
    })),
    ...settings.autoVisitStarts.map((startMinutes): ScheduleRule => ({
      kind: "visit",
      startMinutes,
      durationMinutes: settings.autoVisitDurationMinutes,
    })),
  ];
  const plan = planSessions({
    today,
    weeksAhead: settings.autoSessionsWeeksAhead,
    campusIds: (campuses ?? []).map((c) => c.id),
    closures: closures ?? [],
    rules,
    existing: existing ?? [],
  });
  if (!plan.length) return 0;

  const rows = plan.map((p) => ({
    kind: p.kind,
    campus_id: p.campus_id,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    capacity: settings.autoSessionCapacity,
    is_published: true,
    notes: "Created by the weekday schedule.",
  }));
  // Two drains can overlap — the queue runs every five minutes and a daily
  // Vercel cron hits the same route — and both would read the same gap. The
  // unique index on (campus_id, kind, starts_at) means the second one's rows
  // are refused rather than doubled; asking for them to be ignored keeps that
  // from failing a whole batch of legitimate inserts alongside them.
  let made = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin
      .from("sessions")
      .upsert(rows.slice(i, i + 200), { onConflict: "campus_id,kind,starts_at", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    made += data?.length ?? 0;
  }
  return made;
}
