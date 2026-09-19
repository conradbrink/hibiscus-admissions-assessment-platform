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
  if (event.capacity !== null && event.registered_count + 1 + input.guests > event.capacity && !event.registration) {
    throw new Error("This event is full.");
  }
  if (input.studentId) await requireStudentInFamily(admin, session, input.studentId);

  const contact = (await admin.from("contacts").select("id").eq("family_id", session.familyId).order("created_at").limit(1).maybeSingle()).data;
  const guests = Math.max(0, Math.min(10, input.guests));

  // One row per family per child (or per family, when no child is named):
  // the unique index is on an expression PostgREST cannot name in an
  // upsert, so this is update-then-insert, and an insert that loses a race
  // to a second tap goes round once more.
  const updateExisting = async (): Promise<boolean> => {
    let q = admin
      .from("crm_event_registrations")
      .update({ status: "registered", guests, note: input.note })
      .eq("event_id", input.eventId)
      .eq("family_id", session.familyId);
    q = input.studentId ? q.eq("student_id", input.studentId) : q.is("student_id", null);
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  };
  if (await updateExisting()) return;
  const { error } = await admin.from("crm_event_registrations").insert({
    event_id: input.eventId,
    family_id: session.familyId,
    student_id: input.studentId,
    contact_id: contact?.id ?? null,
    status: "registered",
    source: "parent",
    guests,
    note: input.note,
  });
  if (!error) return;
  if (error.code === "23505" && (await updateExisting())) return;
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
