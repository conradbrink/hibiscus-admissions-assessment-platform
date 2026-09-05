import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainJobs } from "@/lib/workflow/jobs";

/** Drain the queue after the response is sent, so a parent's email follows their click within seconds. */
export function drainSoon(): void {
  after(async () => {
    await drainJobs(createAdminClient()).catch((e) => console.error("[jobs] drain failed", e));
  });
}
