"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { anonymiseExpired } from "@/lib/workflow/automation/retention";
import { commit } from "@/lib/workflow/engine";

const idSchema = z.object({ applicationId: z.uuid() });

function done() {
  revalidatePath("/staff/admin/retention");
}

/** Keep an application out of the retention run, with a reason, under the holder's name. */
export async function holdApplication(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = idSchema.extend({ reason: z.string().trim().min(3).max(300) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    await admin.from("applications").update({ retention_hold: true, retention_hold_reason: p.reason }).eq("id", app.id);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "retention.held", summary: `Kept out of retention: ${p.reason}`, payload: { reason: p.reason } },
      audit: { action: "retention.hold", entityType: "application", entityId: app.id, after: { reason: p.reason } },
      actor: ctx.actor,
    });
    done();
  });
}

export async function releaseApplication(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = idSchema.parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    await admin.from("applications").update({ retention_hold: false, retention_hold_reason: null }).eq("id", app.id);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "retention.released", summary: "Retention hold released", payload: {} },
      audit: { action: "retention.release", entityType: "application", entityId: app.id },
      actor: ctx.actor,
    });
    done();
  });
}

/**
 * Run the retention pass now, under the caller's name. The candidates are
 * the same ones the page listed; a campus-limited administrator's run still
 * anonymises across the school, because the rule is the school's, not the
 * campus's — so this needs settings.write, which campus teams do not hold.
 */
export async function runRetentionNow(): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const result = await anonymiseExpired(createAdminClient(), { force: true, actor: ctx.actor });
    if (result.failed) throw new Error(`${result.anonymised} anonymised, ${result.failed} failed; see the server log.`);
    done();
  });
}
