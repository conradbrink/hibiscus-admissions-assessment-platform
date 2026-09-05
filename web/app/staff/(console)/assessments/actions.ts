"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { mintKioskCode } from "@/lib/assessment/kiosk-server";
import { resolveTemplate } from "@/lib/assessment/templates";
import { getSettings } from "@/lib/settings";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/tokens";
import {
  onAssessmentAbandoned,
  onAssessmentLaunched,
  onAssessmentSubmitted,
  onWritingMarked,
  runMarking,
} from "@/lib/workflow/assessment-actions";

/**
 * Staff actions on a sitting. Reads use the admin client after the
 * permission check because each then writes through the engine; the pages
 * read through RLS.
 */

function done(applicationId: string, attemptId?: string) {
  revalidatePath(`/staff/applications/${applicationId}`);
  revalidatePath("/staff/assessments/today");
  if (attemptId) revalidatePath(`/staff/assessments/attempts/${attemptId}`);
  revalidatePath("/staff/tasks");
  revalidatePath("/staff");
}

export type LaunchState = StaffActionState & {
  code?: string;
  url?: string;
  qr?: string;
  expiresAt?: string;
  attemptId?: string;
  timeLimitMinutes?: number;
};

/**
 * Launch: resolve the template for the child's grade and campus, open the
 * attempt, and mint the code the lab computer will type. The raw code is
 * returned to this one response and stored nowhere readable.
 */
export async function launchAttempt(_: LaunchState, formData: FormData): Promise<LaunchState> {
  try {
    const ctx = await requireStaffAction("assessments.deliver");
    const p = z
      .object({
        applicationId: z.uuid(),
        timeMultiplier: z.coerce.number().min(1).max(3).default(1),
        accommodationNote: z.string().trim().max(300).optional(),
      })
      .parse(Object.fromEntries(formData));
    const admin = createAdminClient();
    const { data: app, error } = await admin
      .from("applications")
      .select("id, status, campus_id, child_first_name, grades!applications_grade_id_fkey(sort_order)")
      .eq("id", p.applicationId)
      .single();
    if (error || !app) throw new Error("Application not found.");
    const { data: booking } = await admin
      .from("bookings")
      .select("id, status")
      .eq("application_id", app.id)
      .in("status", ["booked", "checked_in", "in_progress"])
      .maybeSingle();
    if (!booking) throw new Error("No live booking.");
    if (booking.status === "booked") throw new Error("Check the child in first.");

    const grade = Array.isArray(app.grades) ? app.grades[0] : app.grades;
    const gradeSort = (grade as { sort_order: number } | null)?.sort_order ?? 0;
    const template = await resolveTemplate(admin, { campusId: app.campus_id, gradeSort });
    if (!template) throw new Error("No active assessment template covers this child's grade. Activate one under Assessment templates.");

    const settings = await getSettings(admin);
    const launched = await onAssessmentLaunched(
      admin,
      app,
      booking,
      { templateId: template.id, timeMultiplier: p.timeMultiplier, accommodationNote: p.accommodationNote || null },
      ctx.actor
    );
    const minted = await mintKioskCode(admin, launched.attemptId, settings.kioskCodeMinutes);
    const url = `${siteUrl()}/sit/${minted.code}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    done(app.id, launched.attemptId);
    return {
      ok: true,
      code: minted.code,
      url,
      qr,
      expiresAt: minted.expiresAt.toISOString(),
      attemptId: launched.attemptId,
      timeLimitMinutes: Math.round(launched.timeLimitSeconds / 60),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A fresh code for an attempt that is still waiting to start (the first one expired or was mistyped). */
export async function reissueCode(_: LaunchState, formData: FormData): Promise<LaunchState> {
  try {
    await requireStaffAction("assessments.deliver");
    const p = z.object({ attemptId: z.uuid() }).parse(Object.fromEntries(formData));
    const admin = createAdminClient();
    const { data: attempt } = await admin.from("attempts").select("id, status, application_id, time_limit_seconds").eq("id", p.attemptId).single();
    if (!attempt) throw new Error("Attempt not found.");
    if (attempt.status !== "ready") throw new Error(`The attempt is ${attempt.status}; a code can only be re-issued before it starts.`);
    const settings = await getSettings(admin);
    const minted = await mintKioskCode(admin, attempt.id, settings.kioskCodeMinutes);
    const url = `${siteUrl()}/sit/${minted.code}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    return { ok: true, code: minted.code, url, qr, expiresAt: minted.expiresAt.toISOString(), attemptId: attempt.id, timeLimitMinutes: Math.round(attempt.time_limit_seconds / 60) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function loadAttemptAndApp(attemptId: string) {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin.from("attempts").select("*").eq("id", attemptId).single();
  if (error || !attempt) throw new Error("Attempt not found.");
  const { data: app, error: aErr } = await admin
    .from("applications")
    .select("id, status, child_first_name")
    .eq("id", attempt.application_id)
    .single();
  if (aErr || !app) throw new Error("Application not found.");
  return { admin, attempt, app };
}

export async function abandonAttempt(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.deliver");
    const p = z.object({ attemptId: z.uuid(), reason: z.string().trim().min(3).max(300) }).parse(Object.fromEntries(formData));
    const { admin, attempt, app } = await loadAttemptAndApp(p.attemptId);
    await onAssessmentAbandoned(admin, app, attempt, p.reason, ctx.actor);
    done(app.id, attempt.id);
  });
}

/** Staff hands the paper in for a child who has finished but not pressed Finish. */
export async function submitForChild(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.deliver");
    const p = z.object({ attemptId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, attempt, app } = await loadAttemptAndApp(p.attemptId);
    await onAssessmentSubmitted(admin, app, attempt, { auto: false }, ctx.actor);
    drainSoon();
    done(app.id, attempt.id);
  });
}

/**
 * Rubric marks. The form carries one `marks_<responseId>` field per item
 * the assessor marked; anything left blank is left unmarked.
 */
export async function markWriting(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.score.write");
    const attemptId = z.uuid().parse(formData.get("attemptId"));
    const marks: Array<{ responseId: string; marksAwarded: number }> = [];
    for (const [name, value] of formData.entries()) {
      if (!name.startsWith("marks_") || typeof value !== "string" || value.trim() === "") continue;
      const responseId = z.uuid().parse(name.slice(6));
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error("Marks must be a number, zero or more.");
      marks.push({ responseId, marksAwarded: Math.round(n * 100) / 100 });
    }
    if (!marks.length) throw new Error("Enter marks for at least one response.");
    const { admin, attempt, app } = await loadAttemptAndApp(attemptId);
    await onWritingMarked(admin, attempt, marks, ctx.actor);
    drainSoon();
    done(app.id, attempt.id);
  });
}

/** Re-runs automatic marking. Rubric marks are kept. */
export async function remarkAttempt(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.score.write");
    const p = z.object({ attemptId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, attempt, app } = await loadAttemptAndApp(p.attemptId);
    if (attempt.status !== "submitted" && attempt.status !== "marked") throw new Error("Only a submitted attempt can be marked.");
    await runMarking(admin, attempt.id, ctx.actor);
    drainSoon();
    done(app.id, attempt.id);
  });
}
