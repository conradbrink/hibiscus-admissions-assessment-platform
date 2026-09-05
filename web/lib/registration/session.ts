import "server-only";
import { redirect } from "next/navigation";
import { loadApplicationGraph, type ApplicationGraph } from "@/lib/applications";
import { loadRegistrationBundle, type RegistrationBundle } from "@/lib/registration/load";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";

/**
 * The registration for the parent's session, with the rule for who may
 * edit it: open while the application is registration_incomplete; read-only
 * once submitted or enrolled, except that a rejected document may always be
 * uploaded again; anything earlier goes back to the hub.
 */
export type RegistrationSession = {
  admin: AdminClient;
  graph: ApplicationGraph;
  bundle: RegistrationBundle;
  editable: boolean;
};

export async function registrationForSession(): Promise<RegistrationSession> {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const status = graph.application.status;
  if (status !== "registration_incomplete" && status !== "registration_complete" && status !== "enrolled") redirect("/next");
  const bundle = await loadRegistrationBundle(admin, graph);
  return { admin, graph, bundle, editable: status === "registration_incomplete" };
}
