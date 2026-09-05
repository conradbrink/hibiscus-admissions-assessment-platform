"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { drainJobs } from "@/lib/workflow/jobs";

export async function retryJob(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    await requireStaffAction("admin");
    const jobId = z.uuid().parse(formData.get("jobId"));
    const admin = createAdminClient();
    const { error } = await admin
      .from("jobs")
      .update({ status: "pending", run_after: new Date().toISOString(), attempts: 0, locked_at: null, locked_by: null })
      .eq("id", jobId)
      .in("status", ["failed", "skipped"]);
    if (error) throw new Error(error.message);
    drainSoon();
    revalidatePath("/staff/admin/jobs");
  });
}

export async function drainNow(): Promise<StaffActionState> {
  return guarded(async () => {
    await requireStaffAction("admin");
    await drainJobs(createAdminClient(), 50);
    revalidatePath("/staff/admin/jobs");
  });
}
