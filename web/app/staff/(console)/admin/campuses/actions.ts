"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const schema = z.object({
  campusId: z.guid(),
  name: z.string().trim().min(1).max(80),
  descriptor: z.string().trim().max(120).optional(),
  country: z.enum(["BW", "ZA"]),
  currency: z.enum(["BWP", "ZAR"]),
  address: z.string().trim().max(300).optional(),
  // Stored as typed. Botswana, South Africa and whoever comes next all write
  // a number differently, and a format this file invented would reject one
  // somebody has on a sign outside the building.
  phone: z.string().trim().max(40).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  headName: z.string().trim().max(80).optional(),
  headTitle: z.string().trim().max(80).optional(),
  removeSignature: z.string().optional(),
  isActive: z.string().optional(),
});

const SIGNATURE_MAX_BYTES = 300 * 1024;

/** The uploaded signature as a data URL, or undefined when no file was chosen. */
async function signatureDataUrl(file: FormDataEntryValue | null): Promise<string | undefined> {
  if (!(file instanceof File) || file.size === 0) return undefined;
  if (file.type !== "image/png" && file.type !== "image/jpeg") throw new Error("The signature must be a PNG or JPEG image.");
  if (file.size > SIGNATURE_MAX_BYTES) throw new Error("The signature image must be 300 KB or smaller.");
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${bytes.toString("base64")}`;
}

export async function saveCampus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const entries = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string"));
    const p = schema.parse(entries);
    const uploaded = await signatureDataUrl(formData.get("signature"));
    const { error } = await ctx.supabase
      .from("campuses")
      .update({
        name: p.name,
        descriptor: p.descriptor || null,
        country: p.country,
        currency: p.currency,
        address: p.address || null,
        phone: p.phone || null,
        whatsapp: p.whatsapp || null,
        head_name: p.headName || null,
        head_title: p.headTitle || null,
        ...(p.removeSignature === "1" ? { signature_data_url: null } : uploaded ? { signature_data_url: uploaded } : {}),
        is_active: p.isActive === "1",
      })
      .eq("id", p.campusId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/campuses");
  });
}

export async function createCampus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z
      .object({ code: z.string().trim().regex(/^[a-z0-9_]+$/), name: z.string().trim().min(1).max(80), descriptor: z.string().trim().max(120).optional() })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("campuses").insert({ code: p.code, name: p.name, descriptor: p.descriptor || null, sort_order: 900 });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/campuses");
  });
}
