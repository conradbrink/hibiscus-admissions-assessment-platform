import { redirect } from "next/navigation";
import { AssessmentRunner } from "@/components/kiosk/assessment-runner";
import { StoryPlayer } from "@/components/kiosk/story/story-player";
import { loadDeliveryForm } from "@/lib/assessment/delivery";
import { readKioskSession } from "@/lib/assessment/kiosk-server";
import { storyVoiceProvider } from "@/lib/assessment/story-voice";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { submitAttempt } from "../actions";

/**
 * The sitting. Everything the page loads is scoped to the attempt named by
 * the kiosk cookie; the delivery form carries no keys by construction.
 */
export default async function AssessmentPage() {
  const session = await readKioskSession();
  if (!session) redirect("/sit?reason=expired");
  const admin = createAdminClient();

  const { data: attempt } = await admin.from("attempts").select("*").eq("id", session.attemptId).maybeSingle();
  if (!attempt) redirect("/sit?reason=expired");
  if (attempt.status === "submitted" || attempt.status === "marked") redirect("/sit/done");
  if (attempt.status !== "in_progress" || !attempt.expires_at) redirect("/sit?reason=expired");

  const [{ data: app }, form, { data: saved }, settings, { data: formRow }] = await Promise.all([
    admin.from("applications").select("child_first_name").eq("id", attempt.application_id).single(),
    loadDeliveryForm(admin, attempt.form_id),
    admin.from("attempt_responses").select("form_question_id, response").eq("attempt_id", attempt.id),
    getSettings(admin),
    admin.from("assessment_forms").select("template_id").eq("id", attempt.form_id).single(),
  ]);

  const initial: Record<string, Json> = {};
  for (const r of saved ?? []) initial[r.form_question_id] = r.response;

  // A story template plays as a story; everything else is the paper runner.
  const { data: template } = formRow
    ? await admin.from("assessment_templates").select("delivery, story_character").eq("id", formRow.template_id).maybeSingle()
    : { data: null };
  if (template?.delivery === "story") {
    return (
      <StoryPlayer
        form={form}
        character={template.story_character ?? "Tumi"}
        initialResponses={initial}
        expiresAt={new Date(attempt.expires_at).getTime()}
        graceSeconds={settings.attemptGraceSeconds}
        childName={app?.child_first_name ?? ""}
        submitAction={submitAttempt}
        serverVoice={storyVoiceProvider() === "elevenlabs"}
      />
    );
  }

  return (
    <AssessmentRunner
      form={form}
      initialResponses={initial}
      expiresAt={new Date(attempt.expires_at).getTime()}
      graceSeconds={settings.attemptGraceSeconds}
      childName={app?.child_first_name ?? ""}
      submitAction={submitAttempt}
    />
  );
}
