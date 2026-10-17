"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import type { Json } from "@/lib/supabase/types";
import { staffTransportError } from "@/lib/transport/staff-errors";

/**
 * Opening transport booking: the switch, the office contact, the terms and
 * the periods. Everything runs under the coordinator's own client, so the
 * policies decide: `transport.manage` writes the catalogue and three settings
 * keys (`settings_update_transport`), and nothing else.
 */

const PATH = "/staff/admin/transport";

async function setSetting(key: "transport_booking_enabled" | "transport_office_contact", value: Json): Promise<void> {
  const ctx = await requireStaffAction("transport.manage");
  const { data, error } = await ctx.supabase.from("settings").update({ value, updated_by: ctx.userId }).eq("key", key).select("key");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("You may not change this setting.");
}

export async function setTransportBooking(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const enabled = z.enum(["on", "off"]).parse(formData.get("booking")) === "on";
    await setSetting("transport_booking_enabled", enabled);
    revalidatePath(PATH);
  });
}

export async function saveTransportOfficeContact(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const contact = z.string().trim().max(200, "Keep it to a line.").parse(formData.get("contact") ?? "");
    await setSetting("transport_office_contact", contact);
    revalidatePath(PATH);
  });
}

/** A new version of the terms, published at once. The old version stays, frozen, for the bookings made under it. */
export async function publishTransportTerms(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("transport.manage");
    const body = z.string().trim().min(20, "Write the terms in full.").max(20000).parse(formData.get("body") ?? "");
    const { data: latest, error: lErr } = await ctx.supabase.from("transport_terms").select("version").order("version", { ascending: false }).limit(1);
    if (lErr) throw new Error(lErr.message);
    const { error } = await ctx.supabase.from("transport_terms").insert({
      version: (latest?.[0]?.version ?? 0) + 1,
      body_text: body,
      published_at: new Date().toISOString(),
      published_by: ctx.userId,
    });
    if (error) throw new Error(staffTransportError(error.message));
    revalidatePath(PATH);
  });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

const periodSchema = z.object({
  id: z.guid().optional(),
  kind: z.enum(["term", "month"]),
  termPeriodId: z.guid().optional(),
  monthIndex: z.coerce.number().int().min(1).max(12).optional(),
  label: z.string().trim().min(1, "Give it a name parents will recognise").max(80),
  startsOn: date,
  endsOn: date,
  opensOn: date,
  closesOn: date,
  priceListId: z.guid().optional(),
});

export async function saveTransportPeriod(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("transport.manage");
    const raw = Object.fromEntries([...formData.entries()].filter(([, v]) => v !== ""));
    const p = periodSchema.parse(raw);
    if (p.kind === "month" && (!p.termPeriodId || !p.monthIndex)) throw new Error("A month needs its term and its number.");
    if (p.kind === "term" && !p.id && !p.priceListId) throw new Error("Choose the price list.");

    const row = {
      label: p.label,
      starts_on: p.startsOn,
      ends_on: p.endsOn,
      booking_opens_on: p.opensOn,
      booking_closes_on: p.closesOn,
      is_published: formData.getAll("isPublished").includes("1"),
    };
    if (p.id) {
      const { error } = await ctx.supabase.from("transport_periods").update(row).eq("id", p.id);
      if (error) throw new Error(staffTransportError(error.message));
      revalidatePath(PATH);
      return;
    }

    // A month is priced from its term's list. The trigger copies it whatever
    // is sent; sending the term's own keeps the two from ever disagreeing.
    let priceListId = p.priceListId ?? null;
    if (p.kind === "month") {
      const { data: term, error: tErr } = await ctx.supabase.from("transport_periods").select("price_list_id").eq("id", p.termPeriodId!).single();
      if (tErr || !term) throw new Error("That term could not be found.");
      priceListId = term.price_list_id;
    }
    const { error } = await ctx.supabase.from("transport_periods").insert({
      ...row,
      kind: p.kind,
      term_period_id: p.kind === "month" ? p.termPeriodId! : null,
      month_index: p.kind === "month" ? p.monthIndex! : null,
      price_list_id: priceListId!,
    });
    if (error) throw new Error(staffTransportError(error.message));
    revalidatePath(PATH);
  });
}
