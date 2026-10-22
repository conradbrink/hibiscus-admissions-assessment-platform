import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { loadApplicationGraph, type ApplicationGraph } from "@/lib/applications";
import { loadRegistrationBundle, type RegistrationBundle } from "@/lib/registration/load";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { readParentSession, requireParentSession } from "@/lib/tokens/server";
import { PARENT_ACTOR, type Actor } from "@/lib/workflow/engine";

/**
 * The registration for the parent's session, with the rule for who may
 * edit it: open while the application is registration_incomplete; read-only
 * once submitted or enrolled, except that a rejected document may always be
 * uploaded again; anything earlier goes back to the hub.
 *
 * `actor` is who every save is recorded against. A parent's own link is the
 * parent; a session a member of staff opened at the desk
 * (`startAssistedRegistration`) is that person, so the timeline, the
 * documents and the signed agreements all say the form was filled in with
 * the school's help rather than passing it off as the family's alone.
 */
export type RegistrationSession = {
  admin: AdminClient;
  graph: ApplicationGraph;
  bundle: RegistrationBundle;
  editable: boolean;
  actor: Actor;
  /** The member of staff filling the form in with the family, or null on the parent's own link. */
  assistedBy: { id: string; name: string } | null;
};

export async function registrationForSession(): Promise<RegistrationSession> {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const status = graph.application.status;
  if (status !== "registration_incomplete" && status !== "registration_complete" && status !== "enrolled") redirect("/next");
  const assisted = await assistingStaff(session.assistedBy ?? null, session.applicationId);
  const bundle = await loadRegistrationBundle(admin, graph);
  return { admin, graph, bundle, editable: status === "registration_incomplete", ...assisted };
}

/**
 * The actor for an upload route, which reads the cookie itself rather than
 * through `registrationForSession`. Null when the member of staff who opened
 * the session may no longer act on this child, which the caller refuses.
 */
export async function uploadActor(): Promise<{ actor: Actor; staffId: string | null } | null> {
  const session = await readParentSession();
  if (!session?.assistedBy) return { actor: PARENT_ACTOR, staffId: null };
  const staff = await assistantFor(session.assistedBy, session.applicationId);
  return staff ? { actor: staff.actor, staffId: staff.id } : null;
}

/**
 * Re-checked on every page and save: an account switched off since the
 * session was opened, or one that has since lost the right to act on this
 * child, ends it, as signing out would.
 */
async function assistingStaff(staffId: string | null, applicationId: string): Promise<Pick<RegistrationSession, "actor" | "assistedBy">> {
  if (!staffId) return { actor: PARENT_ACTOR, assistedBy: null };
  const staff = await assistantFor(staffId, applicationId);
  if (!staff) redirect("/link?expired=1");
  return { actor: staff.actor, assistedBy: { id: staff.id, name: staff.name } };
}

/**
 * The member of staff who opened the session, as an actor, or null once they
 * may no longer act on this application. The session runs on the parent's
 * cookie for an hour, so the staff sign-in's own checks never see it: a role
 * cut to read-only, or the campus taken away, has to be asked about here, by
 * the same rules the console applies (`staff_may_write_application`).
 */
async function activeAssistant(admin: AdminClient, staffId: string, applicationId: string): Promise<{ id: string; name: string; actor: Actor } | null> {
  const [{ data: staff }, { data: may, error }] = await Promise.all([
    admin.from("staff_profiles").select("id, full_name, email, is_active").eq("id", staffId).maybeSingle(),
    admin.rpc("staff_may_write_application", { p_staff_id: staffId, p_application_id: applicationId }),
  ]);
  // A failed check is a refusal, never a pass.
  if (error || may !== true || !staff?.is_active) return null;
  return { id: staff.id, name: staff.full_name || staff.email, actor: { type: "staff", id: staff.id, label: `${staff.email}, with the family` } };
}

/**
 * Once per request, however many places ask: the page, the layout's banner
 * and an upload all want the same answer, and each used to look it up again.
 */
const assistantFor = cache((staffId: string, applicationId: string) => activeAssistant(createAdminClient(), staffId, applicationId));

/**
 * The member of staff with this family's form open at the desk, for the
 * banner: null on a parent's own link, and null once they may no longer act
 * (the page itself then ends the session).
 */
export async function assistedSessionStaff(): Promise<{ name: string } | null> {
  const session = await readParentSession();
  if (!session?.assistedBy) return null;
  const staff = await assistantFor(session.assistedBy, session.applicationId);
  return staff ? { name: staff.name } : null;
}
