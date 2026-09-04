import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ComputedProfile } from "@/lib/profile/compute";
import { NARRATIVE_SCHEMA, type Narrative } from "@/lib/profile/narrative";
import { getSettings } from "@/lib/settings";
import type { ApplicationRow, LearningProfileRow } from "@/lib/supabase/types";

/**
 * The published learning profile a parent may see for an application, or
 * null. The gate is on data, not on how the parent arrived: a profile that
 * is not published is not shown, and a declined applicant's profile is
 * shown only when the school shares it.
 */
export async function loadVisibleProfile(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">
): Promise<{ profile: LearningProfileRow; computed: ComputedProfile; narrative: Narrative } | null> {
  const { data: profile, error } = await admin
    .from("learning_profiles")
    .select("*")
    .eq("application_id", app.id)
    .not("published_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) return null;
  if (app.status === "declined") {
    const settings = await getSettings(admin);
    if (!settings.profileSharedOnDecline) return null;
  }
  const narrative = NARRATIVE_SCHEMA.safeParse(profile.narrative);
  if (!narrative.success) return null;
  return { profile, computed: profile.computed as unknown as ComputedProfile, narrative: narrative.data };
}
