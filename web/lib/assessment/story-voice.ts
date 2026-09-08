import "server-only";
import { createHash } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { normaliseNarration } from "@/lib/assessment/story";

/**
 * Tumi's recorded voice. When an ElevenLabs key is set, every line the
 * character says is synthesised once by ElevenLabs and kept in a private
 * storage bucket; the kiosk fetches the recording through /api/sit/voice.
 * Without a key the player falls back to the browser's own voice.
 *
 * The key never leaves this module. Nothing here is exposed to the browser
 * beyond audio bytes for a line the sitting is about to say.
 */

export const VOICE_BUCKET = "story-voice";

/** Lily: a warm, soft British voice from ElevenLabs' premade set. Override with ELEVENLABS_VOICE_ID. */
const DEFAULT_VOICE_ID = "pFZP5JQG7iQjIQuC4Bku";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export type VoiceProvider = "elevenlabs" | "browser";

export function storyVoiceProvider(): VoiceProvider {
  return process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "browser";
}

function voiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
}

function modelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
}

/** Where a line's recording lives. Voice and model are part of the key, so changing either re-records. */
export function voiceObjectPath(text: string): string {
  const hash = createHash("sha256").update(`${voiceId()}:${modelId()}:${normaliseNarration(text)}`).digest("hex");
  return `${voiceId()}/${hash}.mp3`;
}

let ensured = false;
async function ensureBucket(admin: AdminClient): Promise<void> {
  if (ensured) return;
  const { error } = await admin.storage.createBucket(VOICE_BUCKET, {
    public: false,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["audio/mpeg"],
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`storage bucket: ${error.message}`);
  ensured = true;
}

export class VoiceError extends Error {
  constructor(
    public readonly reason: "no_provider" | "empty" | "provider_failed",
    message?: string,
  ) {
    super(message ?? reason);
  }
}

async function fromCache(admin: AdminClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(VOICE_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function synthesiseWithElevenLabs(text: string): Promise<Uint8Array> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new VoiceError("no_provider");
  const base = process.env.ELEVENLABS_API_URL?.replace(/\/$/, "") || "https://api.elevenlabs.io";
  const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId())}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: modelId(),
      // Soft and steady: a storyteller reading to a small child, not a presenter.
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new VoiceError("provider_failed", `ElevenLabs ${res.status}: ${detail}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * The recording for a line: from the cache when it exists, otherwise
 * synthesised, stored and returned. `cached` says which, for the warm-up
 * page's count.
 */
export async function narrationAudio(admin: AdminClient, rawText: string): Promise<{ bytes: Uint8Array; cached: boolean }> {
  if (storyVoiceProvider() !== "elevenlabs") throw new VoiceError("no_provider");
  const text = normaliseNarration(rawText);
  if (!text) throw new VoiceError("empty");
  await ensureBucket(admin);
  const path = voiceObjectPath(text);
  const hit = await fromCache(admin, path);
  if (hit) return { bytes: hit, cached: true };
  const bytes = await synthesiseWithElevenLabs(text);
  const { error } = await admin.storage.from(VOICE_BUCKET).upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  if (error) console.error("[story-voice] cache write failed", error.message);
  return { bytes, cached: false };
}

/**
 * Every recording the current voice has, as object paths. One listing, so
 * checking a whole chapter costs one request rather than one per line.
 */
export async function recordedPaths(admin: AdminClient): Promise<Set<string>> {
  await ensureBucket(admin);
  const out = new Set<string>();
  const dir = voiceId();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(VOICE_BUCKET).list(dir, { limit: 1000, offset });
    if (error) throw new Error(`storage list: ${error.message}`);
    for (const o of data ?? []) out.add(`${dir}/${o.name}`);
    if (!data || data.length < 1000) break;
  }
  return out;
}
