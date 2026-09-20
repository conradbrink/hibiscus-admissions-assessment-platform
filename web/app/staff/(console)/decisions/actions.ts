"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { offerTrialWeek, recordTrialWeekOutcome } from "@/lib/workflow/trial-week";

/**
 * The free trial week, from the review queue. Both need `decisions.override`,
 * the permission a decision needs, because offering a family a week at the
 * school is a decision of that kind.
 */

function refresh(applicationId: string): void {
  revalidatePath("/staff/decisions");
  revalidatePath(`/staff/applications/${applicationId}`);
  revalidatePath("/staff/tasks");
}

export async function offerTrialWeekAction(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("decisions.override");
    const p = z
      .object({
        applicationId: z.guid(),
        startsOn: z.string().trim(),
        endsOn: z.string().trim().optional().or(z.literal("")),
        note: z.string().trim().max(500).optional().or(z.literal("")),
      })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    await offerTrialWeek(admin, app, { startsOn: p.startsOn, endsOn: p.endsOn || null, note: p.note || null, actor: ctx.actor });
    // The invitation is a job; run the queue now so the email goes while
    // the person is still looking.
    drainSoon();
    refresh(p.applicationId);
  });
}

export async function trialWeekOutcomeAction(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("decisions.override");
    const p = z
      .object({
        applicationId: z.guid(),
        trialId: z.guid(),
        status: z.enum(["confirmed", "attended", "no_show", "cancelled"]),
        note: z.string().trim().max(500).optional().or(z.literal("")),
      })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    await recordTrialWeekOutcome(admin, app, p.trialId, p.status, p.note || null, ctx.actor);
    refresh(p.applicationId);
  });
}
