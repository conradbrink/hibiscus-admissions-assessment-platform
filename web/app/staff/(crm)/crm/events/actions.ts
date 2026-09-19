"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { recordCrmAudit } from "@/lib/crm/audit";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

// What a datetime-local input submits; toIso() appends the zone to it.
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const KINDS = ["open_day", "robotics_makeathon", "parent_meeting", "sports_day", "information_session", "holiday_programme", "other"] as const;

const eventSchema = z.object({
  name: z.string().trim().min(1, "Give the event a name.").max(160),
  kind: z.enum(KINDS).default("other"),
  campusId: opt(60),
  startsAt: z.string().regex(LOCAL_DATETIME, "Choose a start date and time."),
  endsAt: z.string().regex(LOCAL_DATETIME).optional().or(z.literal("")),
  location: opt(200),
  description: opt(2000),
  capacity: opt(10),
  staffId: opt(60),
  registrationOpen: z.string().optional(),
});

function toIso(local: string): string {
  // The form gives school-local wall time; every campus is UTC+2.
  return `${local}:00+02:00`;
}

export async function createEvent(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let id: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = eventSchema.parse(Object.fromEntries(formData));
    const capacity = p.capacity ? Number(p.capacity) : null;
    if (p.capacity && (!Number.isInteger(capacity) || capacity! <= 0)) throw new Error("Capacity must be a whole number.");
    const { data, error } = await ctx.supabase
      .from("crm_events")
      .insert({
        name: p.name,
        kind: p.kind,
        campus_id: p.campusId || null,
        starts_at: toIso(p.startsAt),
        ends_at: p.endsAt ? toIso(p.endsAt) : null,
        location: p.location || null,
        description: p.description || null,
        capacity,
        staff_id: p.staffId || null,
        registration_open: p.registrationOpen === "on",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id;
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "event.created", entityType: "event", entityId: data.id, after: { name: p.name, starts_at: toIso(p.startsAt), campus_id: p.campusId || null } });
    revalidatePath("/staff/crm/events");
  });
  if (result.ok && id) redirect(`/staff/crm/events/${id}`);
  return result;
}

export async function updateEvent(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = eventSchema.extend({ eventId: z.guid(), isCancelled: z.string().optional() }).parse(Object.fromEntries(formData));
    const capacity = p.capacity ? Number(p.capacity) : null;
    if (p.capacity && (!Number.isInteger(capacity) || capacity! <= 0)) throw new Error("Capacity must be a whole number.");
    const { error } = await ctx.supabase
      .from("crm_events")
      .update({
        name: p.name,
        kind: p.kind,
        campus_id: p.campusId || null,
        starts_at: toIso(p.startsAt),
        ends_at: p.endsAt ? toIso(p.endsAt) : null,
        location: p.location || null,
        description: p.description || null,
        capacity,
        staff_id: p.staffId || null,
        registration_open: p.registrationOpen === "on",
        is_cancelled: p.isCancelled === "on",
      })
      .eq("id", p.eventId);
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "event.updated", entityType: "event", entityId: p.eventId, after: { name: p.name, is_cancelled: p.isCancelled === "on" } });
    revalidatePath(`/staff/crm/events/${p.eventId}`);
    revalidatePath("/staff/crm/events");
  });
}

/** A family registered by hand, by a member of staff. */
export async function registerFamily(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ eventId: z.guid(), familyId: z.guid(), studentId: z.string().optional(), status: z.enum(["invited", "registered"]).default("registered"), guests: z.coerce.number().int().min(0).max(20).default(0) }).parse(Object.fromEntries(formData));
    if (p.studentId) {
      // The form offers the family's children, but the id is the browser's to send.
      const { data: student } = await ctx.supabase.from("students").select("id").eq("id", p.studentId).eq("family_id", p.familyId).maybeSingle();
      if (!student) throw new Error("That child is not one of this family's.");
    }
    const { data: contact } = await ctx.supabase.from("contacts").select("id").eq("family_id", p.familyId).order("created_at").limit(1).maybeSingle();
    const { error } = await ctx.supabase.from("crm_event_registrations").insert({
      event_id: p.eventId,
      family_id: p.familyId,
      student_id: p.studentId || null,
      contact_id: contact?.id ?? null,
      status: p.status,
      source: "staff",
      guests: p.guests,
    });
    if (error) {
      if (error.code === "23505") throw new Error("That family is already on the list for this event.");
      throw new Error(error.message);
    }
    revalidatePath(`/staff/crm/events/${p.eventId}`);
    revalidatePath(`/staff/crm/families/${p.familyId}`);
  });
}

export async function setRegistrationStatus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ registrationId: z.guid(), eventId: z.guid(), status: z.enum(["invited", "registered", "attended", "no_show", "cancelled"]) }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("crm_event_registrations").update({ status: p.status }).eq("id", p.registrationId);
    if (error) throw new Error(error.message);
    revalidatePath(`/staff/crm/events/${p.eventId}`);
  });
}

/** Everyone in a segment is invited: one row each, status invited, so the follow-up campaign has a list and the attendance figures a denominator. */
export async function inviteSegment(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ eventId: z.guid(), segmentId: z.guid() }).parse(Object.fromEntries(formData));
    const { listSegment, parseRules } = await import("@/lib/crm/segments-server");
    const { data: segment } = await ctx.supabase.from("segments").select("*").eq("id", p.segmentId).maybeSingle();
    if (!segment) throw new Error("That segment is not one you can see.");
    const families = await listSegment(ctx.supabase, parseRules(segment.rules), segment.campus_id);
    // A family already on the list keeps whatever it said; only the rest
    // are invited. The unique index is on an expression, which is not a
    // target an upsert can name, so the existing rows are read first.
    const { data: existing } = await ctx.supabase.from("crm_event_registrations").select("family_id").eq("event_id", p.eventId);
    const already = new Set((existing ?? []).map((r) => r.family_id));
    const rows = families
      .filter((f) => !already.has(f.family_id))
      .map((f) => ({ event_id: p.eventId, family_id: f.family_id, contact_id: f.primary_contact_id, status: "invited" as const, source: "staff" as const }));
    let added = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const { error } = await ctx.supabase.from("crm_event_registrations").insert(slice);
      if (error) throw new Error(error.message);
      added += slice.length;
    }
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "event.segment_invited", entityType: "event", entityId: p.eventId, after: { segment_id: p.segmentId, families: families.length, added } });
    revalidatePath(`/staff/crm/events/${p.eventId}`);
  });
}
