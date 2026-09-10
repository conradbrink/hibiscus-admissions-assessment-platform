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
        campusId: z.guid(),
        academicYearId: z.guid(),
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
 *
 * The scope is editable too: a band that no longer covers the grades the
 * campus teaches, or a schedule built against the wrong year, used to mean
 * delete and retype, and delete only works on drafts. Editing it changes
 * which schedule wins the *next* offer and nothing about one already sent,
 * because an offer freezes its own copy of the fees at drafting.
 *
 * Moving a schedule to a campus in another currency is the one move that
 * cannot be quiet. A trigger rewrites the currency from the campus, so
 * P 300.00 would silently become R 300.00 on every line. That needs saying
 * out loud and agreeing to, so it is refused until it is.
 */
export async function saveSchedule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const scheduleId = z.guid().parse(formData.get("scheduleId"));
    const status = z.enum(["draft", "active"]).parse(formData.get("status") ?? "draft");
    const name = z.string().trim().min(1).max(120).parse(formData.get("name"));
    const scope = z
      .object({
        campusId: z.guid(),
        academicYearId: z.guid(),
        gradeSortMin: z.union([z.literal(""), z.coerce.number().int()]).optional(),
        gradeSortMax: z.union([z.literal(""), z.coerce.number().int()]).optional(),
      })
      .parse({
        campusId: formData.get("campusId"),
        academicYearId: formData.get("academicYearId"),
        gradeSortMin: formData.get("gradeSortMin") ?? "",
        gradeSortMax: formData.get("gradeSortMax") ?? "",
      });
    const bandMin = scope.gradeSortMin === "" || scope.gradeSortMin === undefined ? null : scope.gradeSortMin;
    const bandMax = scope.gradeSortMax === "" || scope.gradeSortMax === undefined ? null : scope.gradeSortMax;
    if (bandMin !== null && bandMax !== null && bandMax < bandMin) {
      throw new Error("The band runs backwards — the last grade comes before the first.");
    }

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
    // The currency is not ours to set — a trigger takes it from the campus —
    // so the check is on what that trigger is about to do to the amounts.
    const [{ data: current }, { data: target }] = await Promise.all([
      ctx.supabase.from("fee_schedules").select("currency").eq("id", scheduleId).single(),
      ctx.supabase.from("campuses").select("name, currency").eq("id", scope.campusId).single(),
    ]);
    if (current && target && current.currency !== target.currency && formData.get("allowCurrencyChange") !== "1") {
      throw new Error(
        `${target.name} is a ${target.currency} campus and this schedule is in ${current.currency}. ` +
          `Moving it keeps every amount as typed, so ${current.currency} 300.00 becomes ${target.currency} 300.00 — ` +
          "a different sum of money. Tick \u201clet this change the currency\u201d if that is what you want, then check the amounts."
      );
    }

    const { error } = await ctx.supabase
      .from("fee_schedules")
      .update({
        name,
        status,
        campus_id: scope.campusId,
        academic_year_id: scope.academicYearId,
        grade_sort_min: bandMin,
        grade_sort_max: bandMax,
      })
      .eq("id", scheduleId);
    if (error) throw new Error(error.message);
    done();
  });
}

/** Bank details for a currency (the default) or for one campus. Blank deactivates. */
export async function saveBankInstructions(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z.object({ currency: z.enum(["BWP", "ZAR"]), campusId: z.guid().optional(), bodyText: z.string().max(2000) }).parse(Object.fromEntries(formData));
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
    const scheduleId = z.guid().parse(formData.get("scheduleId"));
    const { error } = await ctx.supabase.from("fee_schedules").delete().eq("id", scheduleId).eq("status", "draft");
    if (error) throw new Error(error.message);
    done();
  });
}
