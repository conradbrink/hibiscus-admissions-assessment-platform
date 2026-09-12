import "server-only";
import { after } from "next/server";
import { ZodError } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthCheckUnavailable, ForbiddenError, SecondFactorRequired, type StaffContext } from "@/lib/staff/session";
import type { ApplicationRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";
import { drainJobs } from "@/lib/workflow/jobs";

/**
 * Turns thrown errors into the {error} a form can show. Actions throw an
 * Error whose message is written for the person at the screen ("No active
 * fee schedule covers this campus, grade and year"), so the message is what
 * they see; only a validation failure or something that is not an Error at
 * all gets the generic line. Everything unexpected is also logged.
 */
export async function guarded(fn: () => Promise<void>): Promise<StaffActionState> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "You do not have permission to do that." };
    // Half signed in, not forbidden. Every action in the console can now end
    // this way, and the person needs telling what to do rather than being told
    // they lack a permission they may well hold.
    if (e instanceof SecondFactorRequired) {
      return {
        error:
          e.outcome === "verify"
            ? "Your sign-in needs your authenticator code. Reload this page and enter it, then try again."
            : "This school requires an authenticator app. Reload this page to set one up, then try again.",
      };
    }
    if (e instanceof AuthCheckUnavailable) return { error: e.message };
    if (e instanceof WorkflowError) {
      if (e.code === "status_conflict") {
        return { error: "This application changed while you were looking at it. Reload and try again." };
      }
      return { error: e.message };
    }
    if (e instanceof ZodError) {
      return { error: "Some of what was entered is not valid. Check the form and try again." };
    }
    console.error("[staff action]", e);
    if (e instanceof Error && e.message.trim()) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * The application a staff action is about, read through the caller's own
 * client first so row-level security answers "may this person see it" —
 * a campus administrator who posts another campus's id gets "not found",
 * never a write. The admin client is returned for the engine call that
 * follows; the page already gated the screen, this gates the action.
 */
export async function loadApplicationForStaff(
  ctx: Pick<StaffContext, "supabase">,
  applicationId: string
): Promise<{ admin: ReturnType<typeof createAdminClient>; app: ApplicationRow }> {
  const { data, error } = await ctx.supabase.from("applications").select("*").eq("id", applicationId).maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  if (!data) throw new WorkflowError("Application not found.", "application_not_found");
  return { admin: createAdminClient(), app: data };
}

export function drainSoon(): void {
  after(async () => {
    await drainJobs(createAdminClient()).catch((e) => console.error("[jobs] drain failed", e));
  });
}
