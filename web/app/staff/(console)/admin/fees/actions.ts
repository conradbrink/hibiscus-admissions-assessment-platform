"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { parseMoneyToMinor } from "@/lib/money";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const FEE_CODES = ["registration", "admission", "tuition_annual", "tuition_term"] as const;

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
    const { data, error } = await ctx.supabase
      .from("fee_schedules")
      .insert({
        name: p.name,
        campus_id: p.campusId,
        academic_year_id: p.academicYearId,
        grade_sort_min: p.gradeSortMin === "" || p.gradeSortMin === undefined ? null : p.gradeSortMin,
        grade_sort_max: p.gradeSortMax === "" || p.gradeSortMax === undefined ? null : p.gradeSortMax,
        // Overwritten by the trigger from the campus; a value is required by the insert type.
        currency: "BWP",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // Start with the four standard lines at zero so the form is a matter of filling in numbers.
    const { error: lErr } = await ctx.supabase.from("fee_lines").insert(
      FEE_CODES.map((code, i) => ({
        schedule_id: data.id,
        code,
        label: { registration: "Registration fee", admission: "Admission fee", tuition_annual: "Annual tuition", tuition_term: "Tuition per term" }[code],
        amount_minor: 0,
        payable_at_acceptance: code === "registration" || code === "admission",
        position: i + 1,
      }))
    );
    if (lErr) throw new Error(lErr.message);
    revalidatePath("/staff/admin/fees");
  });
}

/** Saves the four lines and the schedule's status in one go. */
export async function saveSchedule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const scheduleId = z.uuid().parse(formData.get("scheduleId"));
    const status = z.enum(["draft", "active"]).parse(formData.get("status") ?? "draft");
    for (const code of FEE_CODES) {
      const raw = String(formData.get(`amount_${code}`) ?? "").trim();
      const minor = raw === "" ? 0 : parseMoneyToMinor(raw);
      if (minor === null || minor < 0) throw new Error(`"${raw}" is not an amount.`);
      const label = String(formData.get(`label_${code}`) ?? "").trim();
      const payable = formData.get(`payable_${code}`) === "1";
      const { error } = await ctx.supabase
        .from("fee_lines")
        .upsert(
          { schedule_id: scheduleId, code, label: label || code, amount_minor: minor, payable_at_acceptance: payable, position: FEE_CODES.indexOf(code) + 1 },
          { onConflict: "schedule_id,code" }
        );
      if (error) throw new Error(error.message);
    }
    const { error } = await ctx.supabase.from("fee_schedules").update({ status }).eq("id", scheduleId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/fees");
  });
}

/** One set of bank details per currency, for every campus in it. Blank deactivates. */
export async function saveBankInstructions(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const p = z.object({ currency: z.enum(["BWP", "ZAR"]), bodyText: z.string().max(2000) }).parse(Object.fromEntries(formData));
    const body = p.bodyText.trim();
    const { data: existing } = await ctx.supabase.from("bank_instructions").select("id").eq("currency", p.currency).is("campus_id", null).maybeSingle();
    if (existing) {
      const { error } = await ctx.supabase.from("bank_instructions").update({ body_text: body || "(none)", is_active: body.length > 0 }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else if (body) {
      const { error } = await ctx.supabase.from("bank_instructions").insert({ currency: p.currency, campus_id: null, body_text: body, is_active: true });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/staff/admin/fees");
  });
}

export async function deleteSchedule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("finance.write");
    const scheduleId = z.uuid().parse(formData.get("scheduleId"));
    const { error } = await ctx.supabase.from("fee_schedules").delete().eq("id", scheduleId).eq("status", "draft");
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/fees");
  });
}
