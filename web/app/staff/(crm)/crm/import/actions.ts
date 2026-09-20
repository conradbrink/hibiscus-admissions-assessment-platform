"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { commitEdAdminParents, commitEdAdminStudents, previewEdAdminParents, previewEdAdminStudents } from "@/lib/crm/ed-admin-import-server";
import { commitImport, previewImport } from "@/lib/crm/import";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS = ["families", "contacts", "ed_admin_parents", "ed_admin_students"] as const;

export async function uploadImport(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let importId: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.import");
    const file = formData.get("file");
    const kindRaw = String(formData.get("kind") ?? "families");
    const kind = KINDS.find((k) => k === kindRaw);
    const campusId = String(formData.get("campusId") ?? "") || null;
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file.");
    if (file.size > MAX_BYTES) throw new Error("The file is larger than 5 MB. Split it.");
    if (!kind) throw new Error("Choose what the file holds.");
    if (kind === "ed_admin_parents" || kind === "ed_admin_students") {
      const bytes = Buffer.from(await file.arrayBuffer());
      const preview = kind === "ed_admin_parents" ? previewEdAdminParents : previewEdAdminStudents;
      const summary = await preview(ctx.supabase, ctx.userId, { filename: file.name, bytes, campusId });
      importId = summary.importId;
      return;
    }
    const text = await file.text();
    const summary = await previewImport(ctx.supabase, ctx.userId, { kind, filename: file.name, text, campusId });
    importId = summary.importId;
  });
  if (result.ok && importId) redirect(`/staff/crm/import/${importId}`);
  return result;
}

export async function confirmImport(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.import");
    const p = z.object({ importId: z.guid(), defaultCampusId: z.string().optional().or(z.literal("")) }).parse({ importId: formData.get("importId"), defaultCampusId: formData.get("defaultCampusId") });
    const useExisting = new Set<number>();
    const createAnyway = new Set<number>();
    for (const [k, v] of formData.entries()) {
      const m = /^dup_(\d+)$/.exec(k);
      if (!m) continue;
      if (v === "existing") useExisting.add(Number(m[1]));
      if (v === "create") createAnyway.add(Number(m[1]));
    }
    const { data: imp } = await ctx.supabase.from("crm_imports").select("kind").eq("id", p.importId).maybeSingle();
    if (!imp) throw new Error("That import is no longer there.");
    const admin = createAdminClient();
    const choices = { useExisting, createAnyway, defaultCampusId: p.defaultCampusId || null };
    if (imp.kind === "ed_admin_parents") await commitEdAdminParents(ctx.supabase, admin, ctx.actor, p.importId, choices);
    else if (imp.kind === "ed_admin_students") await commitEdAdminStudents(ctx.supabase, admin, ctx.actor, p.importId, choices);
    else await commitImport(ctx.supabase, admin, ctx.actor, p.importId, choices);
    revalidatePath(`/staff/crm/import/${p.importId}`);
    revalidatePath("/staff/crm/families");
    revalidatePath("/staff/crm/students");
  });
}

export async function cancelImport(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.import");
    const { importId } = z.object({ importId: z.guid() }).parse(Object.fromEntries(formData));
    const { data: cancelled, error } = await ctx.supabase.from("crm_imports").update({ status: "cancelled" }).eq("id", importId).eq("status", "previewed").select("id").maybeSingle();
    if (error) throw new Error(error.message);
    // A committed import's rows are the record of what was written; only a
    // preview that was really cancelled loses its rows.
    if (!cancelled) throw new Error("That import is no longer waiting for a decision.");
    await createAdminClient().from("crm_import_rows").delete().eq("import_id", importId);
  });
  if (result.ok) redirect("/staff/crm/import");
  return result;
}
