import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Parent-effort instrumentation. Records one funnel step for an anonymous
 * browser session. Never throws: measurement must not break the thing it is
 * measuring.
 */
export const FUNNEL_STEPS = [
  "join.viewed",
  "enquiry.started",
  "enquiry.submitted",
  "grade.confirmed",
  "slots.viewed",
  "booking.confirmed",
  "callback.requested",
  "visit.booked",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export function isFunnelStep(value: string): value is FunnelStep {
  return (FUNNEL_STEPS as readonly string[]).includes(value);
}

export async function recordFunnelStep(
  admin: AdminClient,
  input: {
    sessionKey: string;
    step: FunnelStep;
    applicationId?: string | null;
    campusId?: string | null;
    gradeId?: string | null;
    elapsedMs?: number | null;
  }
): Promise<void> {
  try {
    await admin.from("funnel_events").insert({
      session_key: input.sessionKey,
      step: input.step,
      application_id: input.applicationId ?? null,
      campus_id: input.campusId ?? null,
      grade_id: input.gradeId ?? null,
      elapsed_ms:
        typeof input.elapsedMs === "number" && input.elapsedMs >= 0 && input.elapsedMs < 86_400_000
          ? Math.round(input.elapsedMs)
          : null,
    });
  } catch (e) {
    console.warn("[funnel] could not record step", (e as Error).message);
  }
}
