import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { formatDateLong } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { reminderDue, type CycleLike, type ResponseLike } from "@/lib/reenrolment/rules";
import { toSchoolDateString } from "@/lib/format-date";
import { enqueueJobs } from "@/lib/workflow/engine";

/**
 * Asking the families, and then chasing the ones who have not answered.
 *
 * Both run in the drain beside the waitlist sweep and the daily digest. Both
 * are gated by `reenrolment_asks_enabled`, which ships off: the school should
 * watch one round work by hand before the product starts writing to every
 * family at a campus at once.
 *
 * A round that is open is the only thing that sends. Closing it stops
 * everything, which is what a person expects "close" to mean.
 */

export type ReenrolmentSweep = { asked: number; chased: number };

type Row = ResponseLike & {
  id: string;
  student_id: string;
  campus_id: string;
  asked_at: string | null;
};

export async function sweepReenrolment(admin: AdminClient, now: Date = new Date()): Promise<ReenrolmentSweep> {
  const settings = await getSettings(admin);
  if (!settings.reenrolmentAsksEnabled) return { asked: 0, chased: 0 };

  const today = toSchoolDateString(now);
  const { data: cycles, error } = await admin
    .from("reenrolment_cycles")
    .select("*, intakes(label), campuses(name)")
    .eq("status", "open")
    .lte("opens_on", today);
  if (error) throw new Error(error.message);

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const sweep: ReenrolmentSweep = { asked: 0, chased: 0 };

  for (const cycle of cycles ?? []) {
    const { data: responses } = await admin
      .from("reenrolment_responses")
      .select("id, student_id, campus_id, intent, answered_at, asked_at, reminders_sent, last_reminder_at, details_confirmed_at, students(legal_first_name, preferred_name, family_id), campuses!reenrolment_responses_campus_id_fkey(name)")
      .eq("cycle_id", cycle.id);

    const term = one(cycle.intakes)?.label ?? "next term";
    const closes = formatDateLong(cycle.closes_on);

    for (const r of responses ?? []) {
      const student = one(r.students);
      if (!student?.family_id) continue;
      const campus = one(r.campuses)?.name ?? one(cycle.campuses)?.name ?? "Hibiscus";
      const variables = {
        student_first_name: student.preferred_name || student.legal_first_name,
        term,
        campus,
        closes_on: closes,
      };

      // The first ask. `asked_at` is stamped whether or not the send
      // succeeds, because the job carries its own idempotency and retries;
      // stamping only on success would ask twice on the next sweep.
      if (!r.asked_at) {
        await enqueueJobs(admin, [
          {
            type: "send_email",
            applicationId: null,
            idempotencyKey: `reenrol:${r.id}:ask`,
            payload: {
              template_key: "reenrolment_ask",
              family_id: student.family_id,
              student_id: r.student_id,
              family_link: "reenrolment",
              variables,
            },
          },
        ]);
        await admin.from("reenrolment_responses").update({ asked_at: now.toISOString() }).eq("id", r.id);
        sweep.asked += 1;
        continue;
      }

      if (reminderDue(r as Row, cycle as unknown as CycleLike, today)) {
        await enqueueJobs(admin, [
          {
            type: "send_email",
            applicationId: null,
            idempotencyKey: `reenrol:${r.id}:chase:${r.reminders_sent}`,
            payload: {
              template_key: "reenrolment_reminder",
              family_id: student.family_id,
              student_id: r.student_id,
              family_link: "reenrolment",
              variables,
            },
          },
        ]);
        await admin
          .from("reenrolment_responses")
          .update({ reminders_sent: r.reminders_sent + 1, last_reminder_at: now.toISOString() })
          .eq("id", r.id);
        sweep.chased += 1;
      }
    }
  }

  return sweep;
}
