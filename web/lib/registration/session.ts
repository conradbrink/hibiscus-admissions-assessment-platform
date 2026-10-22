import "server-only";
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
  const assisted = await assistingStaff(admin, session.assistedBy ?? null);
  const bundle = await loadRegistrationBundle(admin, graph);
  return { admin, graph, bundle, editable: status === "registration_incomplete", ...assisted };
}

/**
 * The actor for an upload route, which reads the cookie itself rather than
 * through `registrationForSession`. Null when the assisting account has been
 * switched off since the session was opened, which the caller refuses.
 */
export async function uploadActor(admin: AdminClient): Promise<{ actor: Actor; staffId: string | null } | null> {
  const session = await readParentSession();
  if (!session?.assistedBy) return { actor: PARENT_ACTOR, staffId: null };
  const { data: staff } = await admin.from("staff_profiles").select("id, email, is_active").eq("id", session.assistedBy).maybeSingle();
  if (!staff?.is_active) return null;
  return { actor: staffActor(staff), staffId: staff.id };
}

function staffActor(staff: { id: string; email: string }): Actor {
  return { type: "staff", id: staff.id, label: `${staff.email}, with the family` };
}

/**
 * Re-checked on every page and save: an account switched off since the
 * session was opened ends it, as signing out would.
 */
async function assistingStaff(admin: AdminClient, staffId: string | null): Promise<Pick<RegistrationSession, "actor" | "assistedBy">> {
  if (!staffId) return { actor: PARENT_ACTOR, assistedBy: null };
  const { data: staff } = await admin.from("staff_profiles").select("id, full_name, email, is_active").eq("id", staffId).maybeSingle();
  if (!staff?.is_active) redirect("/link?expired=1");
  return { actor: staffActor(staff), assistedBy: { id: staff.id, name: staff.full_name || staff.email } };
}
