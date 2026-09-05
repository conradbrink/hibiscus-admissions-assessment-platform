import "server-only";
import { after } from "next/server";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError, type StaffContext } from "@/lib/staff/session";
import type { ApplicationRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";
import { drainJobs } from "@/lib/workflow/jobs";

/** Turns thrown errors into the {error} a form can show. */
export async function guarded(fn: () => Promise<void>): Promise<StaffActionState> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "You do not have permission to do that." };
    if (e instanceof WorkflowError) {
      if (e.code === "status_conflict") {
        return { error: "This application changed while you were looking at it. Reload and try again." };
      }
      return { error: e.message };
    }
    console.error("[staff action]", e);
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
