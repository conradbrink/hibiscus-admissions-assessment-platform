"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { parseNewLine, parseSubmittedLines } from "@/lib/fees/codes";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

function done() {
  revalidatePath("/staff/admin/fees");
}

export async function createSchedule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z
      .object({
        name: z.string().trim().min(1).max(120),
        campusId: z.uuid(),
        academicYearId: z.uuid(),
        gradeSortMin: z.union([z.literal(""), z.coerce.number().int()]).optional(),
        gradeSortMax: z.union([z.literal(""), z.coerce.number().int()]).optional(),
      })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("fee_schedules").insert({
      name: p.name,
      campus_id: p.campusId,
      academic_year_id: p.academicYearId,
      grade_sort_min: p.gradeSortMin === "" || p.gradeSortMin === undefined ? null : p.gradeSortMin,
      grade_sort_max: p.gradeSortMax === "" || p.gradeSortMax === undefined ? null : p.gradeSortMax,
      // Overwritten by the trigger from the campus; a value is required by the insert type.
      currency: "BWP",
    });
    if (error) throw new Error(error.message);
    // Deliberately no fee lines. A new schedule used to arrive carrying all
    // five standard fees at zero, so every schedule listed fees nobody had
    // asked for and the school had to remember which zeroes were real. Fees
    // are added on the schedule itself, and it stays a draft until it has one.
    done();
  });
}

/**
 * Saves one schedule: its name, its status, and the fees on it.
 *
 * The lines it writes are the lines the card rendered, carried on the form as
 * `lineCode` fields. This used to be a loop over a hard-coded list of five fee
 * codes, which had two consequences. Saving a schedule that had one fee wrote
 * five, four of them zero — and every line prints on the parent's offer letter
 * and in the PDF, so a pre-school offer was one press away from quoting
 * "Tuition per term P 0.00". And a fee the list had never heard of — Bana
 * Tlokweng's annual stationery — rendered as an editable field whose edits
 * went nowhere.
 */
export async function saveSchedule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const scheduleId = z.uuid().parse(formData.get("scheduleId"));
    const status = z.enum(["draft", "active"]).parse(formData.get("status") ?? "draft");
    const name = z.string().trim().min(1).max(120).parse(formData.get("name"));

    const rendered = formData.getAll("lineCode").map(String);
    const { keep, remove } = parseSubmittedLines(formData, rendered);
    const added = parseNewLine(formData, rendered);
    const lines = added ? [...keep, added] : keep;

    // An active schedule with no fees is what sends a parent a letter quoting
    // nothing, so the two states are not allowed to meet. Saving as a draft is
    // always available, which is how a half-built schedule is parked.
    if (status === "active" && lines.length === 0) {
      throw new Error(
        "A schedule with no fees cannot be active — an offer using it would quote nothing. Add a fee, or save it as a draft."
      );
    }

    if (remove.length > 0) {
      const { error } = await ctx.supabase.from("fee_lines").delete().eq("schedule_id", scheduleId).in("code", remove);
      if (error) throw new Error(error.message);
    }
    for (const l of lines) {
      const { error } = await ctx.supabase.from("fee_lines").upsert(
        {
          schedule_id: scheduleId,
          code: l.code,
          label: l.label,
          amount_minor: l.amount_minor,
          payable_at_acceptance: l.payable_at_acceptance,
          position: l.position,
        },
        { onConflict: "schedule_id,code" }
      );
      if (error) throw new Error(error.message);
    }
    const { error } = await ctx.supabase.from("fee_schedules").update({ name, status }).eq("id", scheduleId);
    if (error) throw new Error(error.message);
    done();
  });
}

/** Bank details for a currency (the default) or for one campus. Blank deactivates. */
export async function saveBankInstructions(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z.object({ currency: z.enum(["BWP", "ZAR"]), campusId: z.uuid().optional(), bodyText: z.string().max(2000) }).parse(Object.fromEntries(formData));
    const body = p.bodyText.trim();
    const campusId = p.campusId ?? null;
    let lookup = ctx.supabase.from("bank_instructions").select("id").eq("currency", p.currency);
    lookup = campusId ? lookup.eq("campus_id", campusId) : lookup.is("campus_id", null);
    const { data: existing } = await lookup.maybeSingle();
    if (existing) {
      const { error } = await ctx.supabase.from("bank_instructions").update({ body_text: body || "(none)", is_active: body.length > 0 }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else if (body) {
      const { error } = await ctx.supabase.from("bank_instructions").insert({ currency: p.currency, campus_id: campusId, body_text: body, is_active: true });
      if (error) throw new Error(error.message);
    }
    done();
  });
}

export async function deleteSchedule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const scheduleId = z.uuid().parse(formData.get("scheduleId"));
    const { error } = await ctx.supabase.from("fee_schedules").delete().eq("id", scheduleId).eq("status", "draft");
    if (error) throw new Error(error.message);
    done();
  });
}
