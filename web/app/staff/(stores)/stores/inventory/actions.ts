"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMoneyToMinor } from "@/lib/money";
import type { StaffContext } from "@/lib/staff/session";
import { MAX_PHOTO_BYTES, stripJpegMetadata, toByteaHex } from "@/lib/stores/photo";
import { requireStaffAction } from "@/lib/staff/session";
import { rpcResult, recorded, requestIdFrom, storesGuarded, text, wholeNumber, type StoresActionState } from "@/lib/stores/server";
import { ITEM_TYPES, storesErrorMessage, type AdjustmentKind } from "@/lib/stores/rules";

const itemFields = z.object({
  name: z.string().trim().min(1, "Give the item a name.").max(120),
  categoryId: z.guid("Choose a category."),
  itemType: z.enum(ITEM_TYPES as unknown as [string, ...string[]], "Choose what kind of item this is."),
  unit: z.string().trim().min(1).max(30).default("each"),
  locationId: z.guid().optional().or(z.literal("")),
});

function money(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const minor = parseMoneyToMinor(s);
  if (minor === null || minor < 0) throw new Error("The price must be an amount, for example 450 or 1,250.50.");
  return minor;
}

/**
 * The photo in the form, checked before anything is written: a JPEG (the
 * phone re-encodes every photo to one), small enough, with its metadata
 * segments taken out. Null when no photo was chosen.
 */
async function photoFrom(formData: FormData): Promise<{ bytes: Uint8Array; width: number | null; height: number | null } | null> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_PHOTO_BYTES) throw new Error("That photo is too large. Take it again; the app makes it smaller before it is sent.");
  const stripped = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
  if (!stripped) throw new Error("That photo could not be read. Take it again with the camera, or choose a JPEG.");
  const dim = (k: string) => {
    const n = Number(formData.get(k));
    return Number.isInteger(n) && n > 0 && n <= 4000 ? n : null;
  };
  return { bytes: stripped, width: dim("photoWidth"), height: dim("photoHeight") };
}

async function savePhoto(ctx: StaffContext, itemId: string, photo: NonNullable<Awaited<ReturnType<typeof photoFrom>>>): Promise<void> {
  const { error } = await ctx.supabase
    .from("stores_item_photos")
    .upsert({ item_id: itemId, bytes: toByteaHex(photo.bytes), width: photo.width, height: photo.height }, { onConflict: "item_id" });
  if (error) throw new Error(storesErrorMessage(error));
}

function firstIssue(e: unknown): never {
  if (e instanceof z.ZodError) throw new Error(e.issues[0]?.message ?? "Some of what was entered is not valid.");
  throw e;
}

/** Adds an item to the register, with its opening stock recorded as its first receipt. */
export async function createItem(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const f = (() => {
      try {
        return itemFields.parse({
          name: formData.get("name"),
          categoryId: formData.get("categoryId"),
          itemType: formData.get("itemType"),
          unit: formData.get("unit") || "each",
          locationId: formData.get("locationId") ?? "",
        });
      } catch (e) {
        return firstIssue(e);
      }
    })();
    const minStock = wholeNumber(formData.get("minStock")) ?? 0;
    const opening = wholeNumber(formData.get("openingQuantity")) ?? 0;
    // Checked before the item is created, so a bad photo does not leave an
    // item behind that the person then tries to add a second time.
    const photo = await photoFrom(formData);
    if (minStock < 0) throw new Error("The reorder level must be zero or more.");
    if (opening < 0) throw new Error("The opening quantity must be zero or more.");
    const data = await rpcResult(
      ctx.supabase.rpc("stores_create_item", {
        p_request_id: requestIdFrom(formData),
        p_name: f.name,
        p_category_id: f.categoryId,
        p_item_type: f.itemType as "reusable",
        p_unit: f.unit,
        p_description: text(formData.get("description")),
        p_min_stock: minStock,
        p_location_id: f.locationId || null,
        p_purchase_price_minor: money(formData.get("price")),
        p_supplier: text(formData.get("supplier"), 160),
        p_opening_quantity: opening,
      })
    );
    const { id } = recorded(data);
    let message = `${f.name} is on the register.`;
    if (photo) {
      try {
        await savePhoto(ctx, id, photo);
      } catch (e) {
        message = `${f.name} is on the register, but the photo was not saved: ${e instanceof Error ? e.message : "try again from Edit"}.`;
      }
    }
    const { data: item } = await ctx.supabase.from("stores_items").select("id, name, unit, item_type, qty_available").eq("id", id).maybeSingle();
    revalidatePath("/staff/stores", "layout");
    return { id, message, item: item ?? undefined };
  });
}

/**
 * Changes what an item is called, how it is grouped and where it is kept. The
 * balances are not here and cannot be: staff hold no grant on them, and a
 * count that is wrong is corrected with a documented adjustment.
 */
export async function updateItem(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const id = z.guid().parse(formData.get("id"));
    const f = (() => {
      try {
        return itemFields.parse({
          name: formData.get("name"),
          categoryId: formData.get("categoryId"),
          itemType: formData.get("itemType"),
          unit: formData.get("unit") || "each",
          locationId: formData.get("locationId") ?? "",
        });
      } catch (e) {
        return firstIssue(e);
      }
    })();
    const minStock = wholeNumber(formData.get("minStock")) ?? 0;
    if (minStock < 0) throw new Error("The reorder level must be zero or more.");
    const photo = await photoFrom(formData);
    const { data, error } = await ctx.supabase
      .from("stores_items")
      .update({
        name: f.name,
        description: text(formData.get("description")),
        category_id: f.categoryId,
        item_type: f.itemType as "reusable",
        unit: f.unit,
        min_stock: minStock,
        location_id: f.locationId || null,
        purchase_price_minor: money(formData.get("price")),
        supplier: text(formData.get("supplier"), 160),
        is_active: formData.get("isActive") === "on",
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(/stores_items_name_key/.test(error.message) ? `An item called "${f.name}" is already on the register.` : storesErrorMessage(error));
    if (!data) throw new Error("That item was not found, or you may not change it.");
    if (photo) await savePhoto(ctx, id, photo);
    else if (formData.get("removePhoto") === "1") {
      const { error: pErr } = await ctx.supabase.from("stores_item_photos").delete().eq("item_id", id);
      if (pErr) throw new Error(storesErrorMessage(pErr));
    }
    revalidatePath("/staff/stores", "layout");
    return { id, message: "Saved." };
  });
}

const ADJUST_KINDS: readonly AdjustmentKind[] = ["count_correction", "mark_damaged", "repaired", "write_off", "write_off_outstanding"];

/** A documented correction on one item. The database decides who may make which kind. */
export async function adjustStock(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    // The floor; `stores_adjust` asks for stores.admin itself where a kind needs it.
    const ctx = await requireStaffAction("stores.write");
    const itemId = z.guid().parse(formData.get("itemId"));
    const kind = String(formData.get("kind") ?? "") as AdjustmentKind;
    if (!ADJUST_KINDS.includes(kind)) throw new Error("Choose what kind of adjustment this is.");
    let quantity = wholeNumber(formData.get("quantity"));
    if (quantity === null || quantity <= 0) throw new Error("Enter how many.");
    if (kind === "count_correction" && formData.get("direction") === "down") quantity = -quantity;
    const reason = text(formData.get("reason"), 500);
    if (!reason || reason.length < 3) throw new Error("Say why, in a few words.");
    const lineId = String(formData.get("checkoutLineId") ?? "") || null;
    const data = await rpcResult(
      ctx.supabase.rpc("stores_adjust", {
        p_request_id: requestIdFrom(formData),
        p_item_id: itemId,
        p_kind: kind,
        p_quantity: quantity,
        p_reason: reason,
        p_checkout_line_id: kind === "write_off_outstanding" ? lineId : null,
      })
    );
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Recorded as ${r.reference}.` };
  });
}
