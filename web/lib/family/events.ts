import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { loadFamily, loadFamilyStudents, NotInFamilyError, requireStudentInFamily } from "@/lib/family/scope";
import type { FamilySession } from "@/lib/tokens/session";
import type { CrmEventRow, CrmEventRegistrationRow } from "@/lib/supabase/types";

/**
 * The dates the school invites this family to, and saying yes to one.
 *
 * Every read is scoped by the verified session, like everything under
 * `lib/family`. Which events are offered is decided here, not by the page:
 * the family's campus's and the group-wide ones, upcoming, open, not
 * cancelled.
 */
export type FamilyEvent = CrmEventRow & { campus: { name: string } | null; registration: CrmEventRegistrationRow | null; registered_count: number };

export async function loadFamilyEvents(admin: AdminClient, session: FamilySession): Promise<FamilyEvent[]> {
  const family = await loadFamily(admin, session);
  if (!family) return [];
  const { data: events, error } = await admin
    .from("crm_events")
    .select("*, campuses(name)")
    .eq("is_cancelled", false)
    .gte("starts_at", new Date(Date.now() - 6 * 3_600_000).toISOString())
    .or(family.campus_id ? `campus_id.is.null,campus_id.eq.${family.campus_id}` : "campus_id.is.null")
    .order("starts_at")
    .limit(20);
  if (error) throw new Error(error.message);
  const ids = (events ?? []).map((e) => e.id);
  if (!ids.length) return [];
  const [{ data: mine, error: mineError }, { data: counts, error: countsError }] = await Promise.all([
    admin.from("crm_event_registrations").select("*").eq("family_id", session.familyId).in("event_id", ids),
    admin.from("crm_event_registrations").select("event_id, guests").in("event_id", ids).in("status", ["registered", "attended"]),
  ]);
  // A count that failed would read as an empty event, and a full one would
  // take another family.
  if (mineError) throw new Error(mineError.message);
  if (countsError) throw new Error(countsError.message);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const registeredCount = new Map<string, number>();
  for (const c of counts ?? []) registeredCount.set(c.event_id, (registeredCount.get(c.event_id) ?? 0) + 1 + c.guests);
  return (events ?? []).map((e) => {
    const { campuses, ...event } = e;
    return {
      ...(event as CrmEventRow),
      campus: one(campuses),
      registration: (mine ?? []).find((r) => r.event_id === e.id && r.student_id === null) ?? (mine ?? []).find((r) => r.event_id === e.id) ?? null,
      registered_count: registeredCount.get(e.id) ?? 0,
    };
  });
}

/**
 * The family says yes. The event has to be one of theirs to see; a child
 * named has to be theirs; a full event is full. Registering twice updates
 * the one row rather than adding a second.
 */
export async function registerFamilyForEvent(
  admin: AdminClient,
  session: FamilySession,
  input: { eventId: string; studentId: string | null; guests: number; note: string | null }
): Promise<void> {
  const events = await loadFamilyEvents(admin, session);
  const event = events.find((e) => e.id === input.eventId);
  if (!event) throw new NotInFamilyError("event");
  if (!event.registration_open) throw new Error("Registration for this event has closed.");
  if (input.studentId) await requireStudentInFamily(admin, session, input.studentId);
  const contact = (await admin.from("contacts").select("id").eq("family_id", session.familyId).order("created_at").limit(1).maybeSingle()).data;

  // The capacity check and the write are one transaction in the database,
  // with the event row locked: two families tapping for the last seat
  // cannot both read one seat left. It replaces this family's row for the
  // same child rather than adding a second.
  const { error } = await admin.rpc("crm_register_family_for_event", {
    p_event_id: input.eventId,
    p_family_id: session.familyId,
    p_student_id: input.studentId,
    p_contact_id: contact?.id ?? null,
    p_guests: Math.max(0, Math.min(10, input.guests)),
    p_note: input.note,
  });
  if (!error) return;
  if (error.message.includes("event_full")) throw new Error("This event is full.");
  if (error.message.includes("registration_closed")) throw new Error("Registration for this event has closed.");
  if (error.message.includes("event_not_found")) throw new NotInFamilyError("event");
  throw new Error(error.message);
}

/** The family changes its mind. Only its own row. */
export async function cancelFamilyRegistration(admin: AdminClient, session: FamilySession, registrationId: string): Promise<void> {
  const { data, error } = await admin
    .from("crm_event_registrations")
    .update({ status: "cancelled" })
    .eq("id", registrationId)
    .eq("family_id", session.familyId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new NotInFamilyError("registration");
}

export { loadFamilyStudents };
