import "server-only";
import { after } from "next/server";
import { ZodError } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { HrError } from "@/lib/errors";
import { drainHrJobs } from "@/lib/jobs/drain";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthCheckUnavailable, ForbiddenError, SecondFactorRequired } from "@/lib/staff/session";

/**
 * Turns a thrown error into the `{error}` a staff form shows. Messages
 * written for the person (an `HrError`) are shown as written; anything
 * unexpected is logged and gets the generic line.
 */
export async function guarded(fn: () => Promise<void>): Promise<StaffActionState> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "You do not have permission to do that." };
    if (e instanceof SecondFactorRequired) {
      return {
        error:
          e.outcome === "verify"
            ? "Your sign-in needs your authenticator code. Reload this page and enter it, then try again."
            : "This school requires an authenticator app. Reload this page to set one up, then try again.",
      };
    }
    if (e instanceof AuthCheckUnavailable) return { error: e.message };
    if (e instanceof HrError) return { error: e.message };
    if (e instanceof ZodError) return { error: "Some of what was entered is not valid. Check the form and try again." };
    console.error("[hr staff action]", e);
    return { error: "Something went wrong. Please try again." };
  }
}

/** Runs the HR job queue once the response has gone, so an email leaves within seconds. */
export function drainSoon(): void {
  after(async () => {
    await drainHrJobs(createAdminClient(), "request").catch((e) => console.error("[hr jobs] drain failed", e));
  });
}
