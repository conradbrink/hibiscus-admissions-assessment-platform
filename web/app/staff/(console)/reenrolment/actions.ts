"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

function done() {
  revalidatePath("/staff/reenrolment");
  revalidatePath("/staff/students");
}

const openSchema = z.object({
  intakeId: z.uuid(),
  campusId: z.union([z.uuid(), z.literal("")]),
  name: z.string().trim().min(1).max(120),
  opensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  askDetails: z.union([z.literal("on"), z.literal("")]).optional(),
});

/**
 * Opens a round: one response per enrolled child in scope, written by the
 * database in one statement so the board is never half-built.
 *
 * The cycle row is inserted through the caller's own client, so RLS decides
 * whether they may ask this campus at all; only the fan-out runs as the
 * service role, because responses have no insert policy on purpose.
 */
export async function openCycle(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const { supabase, profile } = await requireStaffAction("reenrolment.write");
    const parsed = openSchema.parse(Object.fromEntries(formData));
    if (parsed.closesOn < parsed.opensOn) {
      throw new Error("The closing date cannot be before the opening date.");
    }

    const { data: cycle, error } = await supabase
      .from("reenrolment_cycles")
      .insert({
        intake_id: parsed.intakeId,
        campus_id: parsed.campusId || null,
        name: parsed.name,
        opens_on: parsed.opensOn,
        closes_on: parsed.closesOn,
        ask_details_refresh: parsed.askDetails === "on",
        opened_by: profile.id,
      })
      .select("id")
      .single();
    if (error || !cycle) throw new Error(error?.message ?? "Could not create the round.");

    const admin = createAdminClient();
    const { error: rpcError } = await admin.rpc("open_reenrolment_cycle", { p_cycle_id: cycle.id });
    if (rpcError) throw new Error(rpcError.message);
    done();
  });
}

const answerSchema = z.object({
  responseId: z.uuid(),
  intent: z.enum(["returning", "not_returning", "undecided"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Records what a parent said on the phone. Most answers will arrive this way
 * in the first round, so the board has to be a place a person can work from,
 * not only a place that shows what the emails achieved.
 */
export async function recordAnswer(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const { supabase, profile } = await requireStaffAction("students.write");
    const parsed = answerSchema.parse(Object.fromEntries(formData));

    // Through the caller's own client: a response at a campus they cannot
    // reach is not found rather than quietly written.
    const { error } = await supabase
      .from("reenrolment_responses")
      .update({
        intent: parsed.intent,
        reason: parsed.reason || null,
        answered_at: new Date().toISOString(),
        answered_by: "staff",
        answered_by_staff_id: profile.id,
      })
      .eq("id", parsed.responseId);
    if (error) throw new Error(error.message);
    done();
  });
}

const closeSchema = z.object({ cycleId: z.uuid() });

/**
 * Closes a round. The unanswered stay unanswered: a family that was asked
 * and said nothing is the finding, and the board keeps it rather than
 * rounding it away.
 */
export async function closeCycle(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const { supabase, profile } = await requireStaffAction("reenrolment.write");
    const parsed = closeSchema.parse(Object.fromEntries(formData));
    const { error } = await supabase
      .from("reenrolment_cycles")
      .update({ status: "closed", closed_at: new Date().toISOString(), closed_by: profile.id })
      .eq("id", parsed.cycleId);
    if (error) throw new Error(error.message);
    done();
  });
}
