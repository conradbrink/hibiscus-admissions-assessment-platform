import { z } from "zod";
import { readKioskSession } from "@/lib/assessment/kiosk-server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  formQuestionId: z.uuid(),
  response: z.record(z.string(), z.unknown()),
});

/**
 * Autosave. One answer per call, scoped to the attempt in the kiosk cookie;
 * the database refuses anything after the timer plus grace and anything
 * not on this attempt's form.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await readKioskSession();
  if (!session) return Response.json({ error: "no session" }, { status: 401 });

  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await request.json());
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const raw = JSON.stringify(parsed.response);
  if (raw.length > 20_000) return Response.json({ error: "too large" }, { status: 413 });

  const admin = createAdminClient();
  const verdict = await enforceRateLimit(admin, LIMITS.kioskResponse, session.attemptId);
  if (!verdict.ok) return Response.json({ error: "slow down" }, { status: 429 });

  const settings = await getSettings(admin);
  const { error } = await admin.rpc("record_response", {
    p_attempt_id: session.attemptId,
    p_form_question_id: parsed.formQuestionId,
    p_response: parsed.response as Json,
    p_grace_seconds: settings.attemptGraceSeconds,
  });
  if (error) {
    if (error.message.includes("attempt_expired")) return Response.json({ error: "expired" }, { status: 409 });
    if (error.message.includes("attempt_not_in_progress")) return Response.json({ error: "closed" }, { status: 409 });
    if (error.message.includes("question_not_in_form")) return Response.json({ error: "bad question" }, { status: 400 });
    console.error("[kiosk] record_response failed", error.message);
    return Response.json({ error: "failed" }, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
