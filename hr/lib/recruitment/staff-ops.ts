import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs/queue";

/**
 * The smaller things staff do to an application: notes, a person's band on
 * an answer, interviews. Each is called after the action has checked the
 * permission and read the application through the staff member's own client.
 */

export async function addNote(admin: AdminClient, actor: Actor, applicationId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new HrError("Write a note first.");
  const { error } = await admin.from("hr_application_notes").insert({ application_id: applicationId, author_id: actor.id, body: text.slice(0, 5000) });
  if (error) throw new Error(error.message);
}

export async function setHumanBand(
  admin: AdminClient,
  actor: Actor,
  input: { applicationId: string; answerId: string; band: number | null; note: string | null }
): Promise<void> {
  const { data: before } = await admin.from("hr_application_answers").select("human_band, application_id").eq("id", input.answerId).single();
  if (!before || before.application_id !== input.applicationId) throw new HrError("Answer not found.");
  const { error } = await admin
    .from("hr_application_answers")
    .update({
      human_band: input.band,
      human_note: input.note,
      marked_by: input.band === null ? null : actor.id,
      marked_at: input.band === null ? null : new Date().toISOString(),
    })
    .eq("id", input.answerId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, {
    action: "answer_marked",
    entityType: "hr_application_answer",
    entityId: input.answerId,
    applicationId: input.applicationId,
    before: { band: before.human_band } as Json,
    after: { band: input.band } as Json,
  });
  await enqueue(admin, [{ type: "score_recompute", payload: { application_id: input.applicationId }, key: `score:${input.applicationId}:mark:${Date.now()}` }]);
}

export async function setCommunicationBand(admin: AdminClient, actor: Actor, applicationId: string, band: number | null): Promise<void> {
  const { error } = await admin.from("hr_applications").update({ communication_human_band: band }).eq("id", applicationId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "communication_marked", entityType: "hr_application", entityId: applicationId, applicationId, after: { band } as Json });
  await enqueue(admin, [{ type: "score_recompute", payload: { application_id: applicationId }, key: `score:${applicationId}:comm:${Date.now()}` }]);
}

export const InterviewSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time."),
    minutes: z.coerce.number().int().min(15).max(240),
    mode: z.enum(["in_person", "video", "phone"]),
    location: z.string().trim().max(300).optional().transform((v) => v || null),
    panel: z.string().trim().max(300).optional().transform((v) => v || null),
  })
  .refine((v) => v.mode === "in_person" || !!v.location, { message: "Add the video link or the number we will call.", path: ["location"] });

/** The school's clock is UTC+2 all year (Botswana and South Africa). */
function schoolTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+02:00`);
}

export async function scheduleInterview(
  admin: AdminClient,
  actor: Actor,
  applicationId: string,
  campusId: string,
  input: z.infer<typeof InterviewSchema>
): Promise<void> {
  const { data: app } = await admin.from("hr_applications").select("status, stage").eq("id", applicationId).single();
  if (!app || app.status !== "submitted" || app.stage !== "shortlisted") throw new HrError("Shortlist the applicant before inviting them to an interview.");
  const startsAt = schoolTime(input.date, input.time);
  if (startsAt.getTime() < Date.now()) throw new HrError("Choose a time in the future.");
  const { data, error } = await admin
    .from("hr_interviews")
    .insert({
      application_id: applicationId,
      campus_id: campusId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + input.minutes * 60_000).toISOString(),
      mode: input.mode,
      location: input.location,
      panel: input.panel,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not book the interview");
  await admin.from("hr_application_events").insert({ application_id: applicationId, kind: "interview_booked", detail: { starts_at: startsAt.toISOString() }, actor_type: "staff", actor_id: actor.id });
  await audit(admin, actor, { action: "interview_booked", entityType: "hr_interview", entityId: data.id, campusId, applicationId });
  await enqueue(admin, [{ type: "interview_email", payload: { interview_id: data.id, kind: "invite" }, key: `interview:${data.id}:invite` }]);
}

export async function rescheduleInterview(admin: AdminClient, actor: Actor, interviewId: string, input: z.infer<typeof InterviewSchema>): Promise<void> {
  const { data: current } = await admin.from("hr_interviews").select("*").eq("id", interviewId).single();
  if (!current || current.status !== "scheduled") throw new HrError("Only a scheduled interview can be moved.");
  const startsAt = schoolTime(input.date, input.time);
  const sequence = current.ics_sequence + 1;
  const { error } = await admin
    .from("hr_interviews")
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + input.minutes * 60_000).toISOString(),
      mode: input.mode,
      location: input.location,
      panel: input.panel,
      ics_sequence: sequence,
    })
    .eq("id", interviewId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "interview_moved", entityType: "hr_interview", entityId: interviewId, applicationId: current.application_id });
  await enqueue(admin, [{ type: "interview_email", payload: { interview_id: interviewId, kind: "changed" }, key: `interview:${interviewId}:changed:${sequence}` }]);
}

export async function setInterviewStatus(admin: AdminClient, actor: Actor, interviewId: string, to: "completed" | "cancelled", notes: string | null): Promise<void> {
  const { data: current } = await admin.from("hr_interviews").select("*").eq("id", interviewId).single();
  if (!current || current.status !== "scheduled") throw new HrError("This interview is already closed.");
  const { error } = await admin
    .from("hr_interviews")
    .update({ status: to, notes: notes ?? current.notes, ics_sequence: current.ics_sequence + 1 })
    .eq("id", interviewId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: `interview_${to}`, entityType: "hr_interview", entityId: interviewId, applicationId: current.application_id });
  if (to === "cancelled") {
    await enqueue(admin, [{ type: "interview_email", payload: { interview_id: interviewId, kind: "cancelled" }, key: `interview:${interviewId}:cancelled` }]);
  }
}
