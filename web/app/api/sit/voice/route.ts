import { z } from "zod";
import { readKioskSession } from "@/lib/assessment/kiosk-server";
import { devShortcutsAllowed } from "@/lib/deployment";
import { MAX_NARRATION_CHARS } from "@/lib/assessment/story";
import { narrationAudio, storyVoiceProvider, VoiceError } from "@/lib/assessment/story-voice";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({ t: z.string().trim().min(1).max(MAX_NARRATION_CHARS) });

/**
 * One line of Tumi's voice as MP3. Only a computer with an open sitting can
 * ask (the kiosk cookie), or a preview deployment where the walk-through
 * page has no sitting. Lines are cached after their first synthesis, so
 * the rate limit is about runaway loops, not cost.
 */
export async function GET(request: Request): Promise<Response> {
  if (storyVoiceProvider() !== "elevenlabs") return Response.json({ error: "no voice provider" }, { status: 404 });

  const session = await readKioskSession();
  // A walk-through on a developer's machine has no sitting. A preview
  // deployment is not that, and synthesising narration costs money per line.
  if (!session && !devShortcutsAllowed()) return Response.json({ error: "no session" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = query.safeParse({ t: url.searchParams.get("t") ?? "" });
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

  const admin = createAdminClient();
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.storyVoice, session?.attemptId ?? ctx.ipHash ?? "walkthrough");
  if (!verdict.ok) return Response.json({ error: "slow down" }, { status: 429 });

  try {
    const { bytes, cached } = await narrationAudio(admin, parsed.data.t);
    // A copy, so the body is backed by a plain ArrayBuffer whatever the storage client handed back.
    return new Response(bytes.slice(), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=86400",
        "x-voice-cache": cached ? "hit" : "miss",
      },
    });
  } catch (e) {
    if (e instanceof VoiceError && e.reason === "empty") return Response.json({ error: "bad request" }, { status: 400 });
    const detail = e instanceof Error ? e.message.slice(0, 300) : "unknown";
    console.error("[story-voice]", detail);
    // The reason travels with the 503 so the adult strip can say why the
    // browser voice took over. It never carries the key: the provider's
    // own error text is all that is quoted.
    return Response.json({ error: "voice unavailable", reason: e instanceof VoiceError ? e.reason : "unexpected", detail }, { status: 503 });
  }
}
