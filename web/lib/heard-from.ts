/**
 * "How did you hear about us?" — the advertising question on every interest
 * form (assessment, visit, call). The keys match the check constraint on
 * `applications.heard_from`; the wording lives here and nowhere else.
 * Plain English for parents: short, common words, no jargon.
 */
import type { HeardFrom } from "@/lib/supabase/types";

export const HEARD_FROM_OPTIONS = [
  { key: "search", label: "Internet search (Google)" },
  { key: "social_media", label: "Facebook, Instagram or TikTok" },
  { key: "friend_family", label: "A friend or family member" },
  { key: "current_parent", label: "A parent at the school" },
  { key: "school_event", label: "An open day or school event" },
  { key: "radio_print", label: "Radio, newspaper or magazine" },
  { key: "signage", label: "A signboard, billboard or driving past" },
  { key: "other", label: "Somewhere else" },
] as const satisfies ReadonlyArray<{ key: HeardFrom; label: string }>;

export type { HeardFrom };

export const HEARD_FROM_KEYS = HEARD_FROM_OPTIONS.map((o) => o.key) as [HeardFrom, ...HeardFrom[]];

export function heardFromLabel(key: string | null | undefined, detail?: string | null): string {
  if (!key) return "Not asked";
  const found = HEARD_FROM_OPTIONS.find((o) => o.key === key);
  const label = found?.label ?? key.replace(/_/g, " ");
  return key === "other" && detail ? `${label}: ${detail}` : label;
}
