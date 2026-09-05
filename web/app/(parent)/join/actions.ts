"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import type { EnquiryFormState } from "@/components/parent/enquiry-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEnquiry, loadCatalogue } from "@/lib/enquiry";
import { funnelSessionKey } from "@/lib/funnel-session";
import { recordFunnelStep } from "@/lib/funnel";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { startParentSession } from "@/lib/tokens/server";
import { callbackSchema, enquirySchema, fieldErrors } from "@/lib/validation";
import { PARENT_ACTOR } from "@/lib/workflow/engine";
import { onEnquiryCreated } from "@/lib/workflow/actions";
import { drainJobs } from "@/lib/workflow/jobs";
import type { EntryRoute } from "@/lib/supabase/types";

function valuesOf(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

function elapsedFrom(t0: number | undefined): number | null {
  return t0 ? Math.max(0, Date.now() - t0) : null;
}

/**
 * The enquiry. Creates the application, starts the parent's session, and
 * sends them to the grade confirmation. Routing (which emails, which tasks)
 * happens on the *next* screen, once the grade is confirmed — see
 * `confirmGrade` in ../next/actions.ts. The callback route is the
 * exception: there is no grade step, so it routes immediately.
 */
export async function submitEnquiry(
  route: EntryRoute,
  _prev: EnquiryFormState,
  formData: FormData
): Promise<EnquiryFormState> {
  const values = valuesOf(formData);
  const schema = route === "callback" ? callbackSchema : enquirySchema;
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    return { fields: fieldErrors(parsed.error), values };
  }

  const admin = createAdminClient();
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.enquiry, ctx.ipHash ?? "unknown");
  if (!verdict.ok) {
    return { error: "Too many enquiries from this connection. Please try again in a little while.", values };
  }

  const catalogue = await loadCatalogue(admin);
  if (catalogue.intakes.length === 0) {
    return { error: "Applications are not open at the moment. Please try again later or request a call.", values };
  }

  let result;
  try {
    result = await createEnquiry(admin, catalogue, {
      parentFirstName: parsed.data.parentFirstName,
      parentLastName: parsed.data.parentLastName,
      email: parsed.data.email,
      mobile: parsed.data.mobile,
      childFirstName: parsed.data.childFirstName,
      childLastName: parsed.data.childLastName,
      childDateOfBirth: parsed.data.childDateOfBirth,
      campusId: parsed.data.campusId,
      intakeId: parsed.data.intakeId ?? null,
      entryRoute: route,
      whatsappOptIn: parsed.data.whatsappOptIn === "1",
    });
  } catch (e) {
    console.error("[enquiry] create failed", (e as Error).message);
    return { error: "Something went wrong saving your enquiry. Please try again.", values };
  }

  const sessionKey = await funnelSessionKey();
  await recordFunnelStep(admin, {
    sessionKey,
    step: "enquiry.submitted",
    applicationId: result.applicationId,
    campusId: parsed.data.campusId,
    gradeId: result.gradeId,
    elapsedMs: elapsedFrom(parsed.data.t0),
  });

  const settings = await getSettings(admin);
  await startParentSession(result.applicationId, "next_step", settings.parentSessionMinutes);

  if (route === "callback") {
    const cb = parsed.data as { preferredTime?: string; message?: string };
    if (result.created) {
      await admin.from("callback_requests").insert({
        application_id: result.applicationId,
        preferred_time: cb.preferredTime || null,
        message: cb.message || null,
      });
      const { data: app } = await admin
        .from("applications")
        .select("id, reference, status, entry_route, requires_assessment, child_first_name")
        .eq("id", result.applicationId)
        .single();
      if (app && app.status === "new_enquiry") {
        await onEnquiryCreated(
          admin,
          app,
          `${parsed.data.parentFirstName} ${parsed.data.parentLastName}`,
          { ...PARENT_ACTOR, ipHash: ctx.ipHash }
        );
      }
      await recordFunnelStep(admin, {
        sessionKey,
        step: "callback.requested",
        applicationId: result.applicationId,
        elapsedMs: elapsedFrom(parsed.data.t0),
      });
      after(async () => {
        await drainJobs(createAdminClient()).catch((e) => console.error("[jobs] drain failed", e));
      });
    }
    redirect("/next");
  }

  redirect("/next/grade");
}
