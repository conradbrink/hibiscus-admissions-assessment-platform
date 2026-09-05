import "server-only";
import { after } from "next/server";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError } from "@/lib/staff/session";
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

export function drainSoon(): void {
  after(async () => {
    await drainJobs(createAdminClient()).catch((e) => console.error("[jobs] drain failed", e));
  });
}
