"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { HEARD_FROM_KEYS } from "@/lib/heard-from";
import { parseMoneyToMinor } from "@/lib/money";
import { normaliseCode } from "@/lib/promotions/apply";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import type { PromotionEffectRow } from "@/lib/supabase/types";

/**
 * Promotions are configured here and applied by the offer engine. The form
 * keeps the choices a school actually makes: waive one or both of the fees
 * paid on acceptance, take something off the admission fee, and add gifts.
 * Each choice becomes an effect row with the wording the parent reads.
 */

const optionalUuid = z.union([z.literal(""), z.guid()]).optional();
const optionalInt = z.union([z.literal(""), z.coerce.number().int()]).optional();
const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional();

const schema = z.object({
  promotionId: z.guid().optional(),
  name: z.string().trim().min(2, "Give the promotion a name").max(80),
  code: z.string().trim().max(24).optional(),
  letterText: z.string().trim().max(400).optional(),
  campusId: optionalUuid,
  academicYearId: optionalUuid,
  gradeSortMin: optionalInt,
  gradeSortMax: optionalInt,
  entryRoute: z.union([z.literal(""), z.enum(["assessment", "visit", "callback"])]).optional(),
  heardFrom: z.union([z.literal(""), z.enum(HEARD_FROM_KEYS)]).optional(),
  startsOn: optionalDate,
  endsOn: optionalDate,
  maxRedemptions: optionalInt,
  waiveRegistration: z.string().optional(),
  waiveAdmission: z.string().optional(),
  admissionDiscountKind: z.enum(["none", "fixed", "percent"]).default("none"),
  admissionDiscountValue: z.string().trim().max(20).optional(),
  gifts: z.string().max(1000).optional(),
  isActive: z.string().optional(),
});

type Effect = Omit<PromotionEffectRow, "id" | "promotion_id">;

/** The effect rows a saved form produces; the labels are the parent-facing wording. */
function effectsFrom(p: z.infer<typeof schema>): Effect[] {
  const out: Effect[] = [];
  let position = 1;
  if (p.waiveRegistration === "1") out.push({ position: position++, kind: "waive_fee", fee_code: "registration", amount_minor: null, percent: null, label: "Application fee waived" });
  if (p.waiveAdmission === "1") out.push({ position: position++, kind: "waive_fee", fee_code: "admission", amount_minor: null, percent: null, label: "Admission fee waived" });
  if (p.waiveAdmission !== "1" && p.admissionDiscountKind !== "none") {
    const raw = p.admissionDiscountValue ?? "";
    if (p.admissionDiscountKind === "fixed") {
      const minor = parseMoneyToMinor(raw);
      if (minor === null || minor <= 0) throw new Error("Enter the admission fee discount as an amount, for example 500.");
      out.push({ position: position++, kind: "discount_fixed", fee_code: "admission", amount_minor: minor, percent: null, label: `${(minor / 100).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} off the admission fee` });
    } else {
      const pct = Number(raw.replace(/%/g, "").trim());
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error("Enter the admission fee discount as a percentage between 1 and 100.");
      out.push({ position: position++, kind: "discount_percent", fee_code: "admission", amount_minor: null, percent: Math.round(pct * 100) / 100, label: `${pct}% off the admission fee` });
    }
  }
  for (const line of (p.gifts ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (line.length > 120) throw new Error("Keep each gift to one short line.");
    out.push({ position: position++, kind: "gift", fee_code: null, amount_minor: null, percent: null, label: line });
  }
  return out;
}

function rowFrom(p: z.infer<typeof schema>, createdBy: string) {
  const code = p.code ? normaliseCode(p.code) : null;
  if (p.code && !code) throw new Error("A code is 3 to 24 letters, digits or hyphens, for example LAUNCH-2027.");
  const min = p.gradeSortMin === "" || p.gradeSortMin === undefined ? null : p.gradeSortMin;
  const max = p.gradeSortMax === "" || p.gradeSortMax === undefined ? null : p.gradeSortMax;
  if (min !== null && max !== null && min > max) throw new Error("The grade range is the wrong way round.");
  const startsOn = p.startsOn || null;
  const endsOn = p.endsOn || null;
  if (startsOn && endsOn && startsOn > endsOn) throw new Error("The promotion ends before it starts.");
  return {
    name: p.name,
    code,
    letter_text: p.letterText || null,
    campus_id: p.campusId || null,
    academic_year_id: p.academicYearId || null,
    grade_sort_min: min,
    grade_sort_max: max,
    entry_route: p.entryRoute || null,
    heard_from: p.heardFrom || null,
    starts_on: startsOn,
    ends_on: endsOn,
    max_redemptions: p.maxRedemptions === "" || p.maxRedemptions === undefined ? null : p.maxRedemptions,
    is_active: p.isActive === "1",
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  };
}

export async function savePromotion(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = schema.parse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")));
    const effects = effectsFrom(p);
    if (effects.length === 0) throw new Error("A promotion needs at least one effect: a waiver, a discount or a gift.");
    const row = rowFrom(p, ctx.userId);

    let promotionId = p.promotionId;
    if (promotionId) {
      const update: Partial<typeof row> = { ...row };
      delete update.created_by;
      const { error } = await ctx.supabase.from("promotions").update(update).eq("id", promotionId);
      if (error) throw new Error(error.message.includes("promotions_code_key") ? "That code is already used by another promotion." : error.message);
    } else {
      const { data, error } = await ctx.supabase.from("promotions").insert(row).select("id").single();
      if (error) throw new Error(error.message.includes("promotions_code_key") ? "That code is already used by another promotion." : error.message);
      promotionId = data.id;
    }
    // Effects are replaced as a set; a deal already on an application keeps
    // the letter it was drafted with (the snapshot is on the offer).
    const { error: delErr } = await ctx.supabase.from("promotion_effects").delete().eq("promotion_id", promotionId);
    if (delErr) throw new Error(delErr.message);
    const { error: insErr } = await ctx.supabase.from("promotion_effects").insert(effects.map((e) => ({ ...e, promotion_id: promotionId })));
    if (insErr) throw new Error(insErr.message);
    revalidatePath("/staff/admin/promotions");
    revalidatePath("/staff/offers");
  });
}

export async function deletePromotion(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const promotionId = z.guid().parse(formData.get("promotionId"));
    const { count } = await ctx.supabase.from("application_promotions").select("application_id", { count: "exact", head: true }).eq("promotion_id", promotionId);
    if ((count ?? 0) > 0) throw new Error("This promotion is on an application already. Switch it off instead of deleting it.");
    const { error } = await ctx.supabase.from("promotions").delete().eq("id", promotionId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/promotions");
    revalidatePath("/staff/offers");
  });
}
