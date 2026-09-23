"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import type { EnquiryFormState } from "@/components/parent/enquiry-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseEmail } from "@/lib/contacts";
import { createEnquiry, loadCatalogue } from "@/lib/enquiry";
import { funnelSessionKey } from "@/lib/funnel-session";
import { recordFunnelStep } from "@/lib/funnel";
import { normaliseCode } from "@/lib/promotions/apply";
import { promotionForCode } from "@/lib/promotions/load";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { readParentSession, startParentSession } from "@/lib/tokens/server";
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
 * Whether this browser may act for the family behind an email address.
 *
 * The form is anonymous, so the only proof it can offer is a parent session
 * it already holds — the case the one-child-one-enquiry rule was written for:
 * a parent who submits, sees the typo, and submits again a minute later. A
 * stranger typing a family's address has no such cookie, and is not allowed to
 * overwrite the parent's name or number, rename the child, or be handed the
 * family's application. They get the link by email instead, which is what
 * proves the address is theirs.
 */
async function trustedForContact(admin: ReturnType<typeof createAdminClient>, emailNormalised: string): Promise<boolean> {
  const { data: contact } = await admin.from("contacts").select("id").eq("email_normalised", emailNormalised).maybeSingle();
  if (!contact) return true; // Nobody to protect yet: a new family.
  const session = await readParentSession();
  if (!session) return false;
  const { data: app } = await admin.from("applications").select("contact_id").eq("id", session.applicationId).maybeSingle();
  return app?.contact_id === contact.id;
}

/**
 * The enquiry. Creates the application, starts the parent's session, and
 * sends them to the grade confirmation. Routing (which emails, which tasks)
 * happens on the *next* screen, once the grade is confirmed — see
 * `confirmGrade` in ../next/actions.ts. The callback route is the
 * exception: there is no grade step, so it routes immediately.
 *
 * An address already on file, from a browser holding no session for that
 * family, is the one path that does not end in a session: the application is
 * found (or a new child is added) and the link goes to the inbox. See
 * `trustedForContact`.
 */
export async function submitEnquiry(
  route: EntryRoute,
  preschool: boolean,
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

  // A typed code is checked before anything is saved, so a typo is fixed on
  // the spot rather than discovered at the offer. The code itself is stored
  // on the application; the deal is applied when the offer is drafted.
  let promoCode: string | null = null;
  if (parsed.data.promoCode) {
    const promo = await promotionForCode(admin, parsed.data.promoCode);
    if (!promo) {
      return { fields: { promoCode: "We do not recognise that code. Check it, or leave it blank." }, values };
    }
    promoCode = normaliseCode(parsed.data.promoCode);
  }

  const trusted = await trustedForContact(admin, normaliseEmail(parsed.data.email));

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
      heardFrom: parsed.data.heardFrom,
      heardFromDetail: parsed.data.heardFromDetail ?? null,
      trusted,
    });
  } catch (e) {
    console.error("[enquiry] create failed", (e as Error).message);
    return { error: "Something went wrong saving your enquiry. Please try again.", values };
  }

  if (promoCode && result.created) {
    await admin.from("applications").update({ promo_code: promoCode }).eq("id", result.applicationId);
  }

  // Additional needs, if the family said so. Only ever set here, never
  // cleared by a later enquiry: a family that told us once should not have to
  // tell us again. Staff are given a task when the grade is confirmed. An
  // anonymous form does not write it onto an application it merely found.
  if (parsed.data.hasSpecialNeeds === "1" && (result.created || trusted)) {
    await admin
      .from("applications")
      .update({
        has_special_needs: true,
        special_needs_detail: parsed.data.specialNeedsDetail?.trim() || null,
      })
      .eq("id", result.applicationId);
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

  if (!trusted) {
    // The address is on file and this browser has not proved it is theirs.
    // No session: the link goes to the inbox, and `/next` routes an unrouted
    // enquiry to the grade step when it is opened. One email a minute,
    // however often the form is pressed; the sweep routes the enquiry after
    // ten minutes either way, so the family is never left without an email.
    await admin.from("jobs").upsert(
      {
        type: "send_email",
        payload: { template_key: "fresh_link" },
        application_id: result.applicationId,
        idempotency_key: `email:${result.applicationId}:fresh_link:${Math.floor(Date.now() / 60_000)}`,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    );
    after(async () => {
      await drainJobs(createAdminClient()).catch((e) => console.error("[jobs] drain failed", e));
    });
    return { linkSent: { email: parsed.data.email.trim() }, values };
  }

  const settings = await getSettings(admin);
  await startParentSession(result.applicationId, "next_step", settings.parentSessionMinutes);

  // The child is already with us, at a campus other than the one just chosen.
  // The session is started first so the button on that screen works; what is
  // skipped is the silent redirect, which used to send a parent who asked for
  // Tlokweng into the next step of their Phase 4 application without a word,
  // and they would finish the journey believing they had applied somewhere
  // they had not. One live application per child is the rule; saying so is the
  // half that was missing.
  if (!result.created && result.campusId !== parsed.data.campusId) {
    return {
      alreadyApplied: {
        childFirstName: parsed.data.childFirstName.trim(),
        campusName: result.campusName,
        reference: result.reference,
      },
      values,
    };
  }

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

  // The pre-school door shows only the classes that need no assessment on
  // the next screen; the flag is a hint for that screen, nothing more.
  redirect(preschool ? "/next/grade?preschool=1" : "/next/grade");
}
